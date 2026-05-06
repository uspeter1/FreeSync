import { App, TFile, TAbstractFile, Notice } from 'obsidian';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { PresenceManager } from './presence';
import { minimalDiff } from './diff';

const LOCAL_ORIGIN = 'local';

export interface SyncSettings {
  relayUrl: string;
  vaultId: string;
  userToken: string;
  userId: string;
  displayName: string;
  color: string;
}

export class SyncManager {
  private providers = new Map<string, WebsocketProvider>();
  private docs = new Map<string, Y.Doc>();
  private manifestDoc: Y.Doc | null = null;
  private manifestProvider: WebsocketProvider | null = null;
  private unsubscribers: (() => void)[] = [];
  private settings: SyncSettings | null = null;
  // Paths currently being created/deleted by incoming remote ops — skip re-broadcasting
  private remoteFileOps = new Set<string>();

  constructor(private app: App, private presence: PresenceManager) {}

  async start(settings: SyncSettings) {
    this.settings = settings;
    await this.connectManifest();
    this.watchVault();
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) await this.connectFile(activeFile.path);
  }

  // ── Manifest room ──────────────────────────────────────────────────────────
  // Always connected. Carries:
  //   • Yjs Awareness → global presence (all vault members visible)
  //   • Y.Map 'files' → file tree (create/delete propagation)

  private connectManifest() {
    if (!this.settings) return;
    const { relayUrl, vaultId, userToken } = this.settings;

    this.manifestDoc = new Y.Doc();
    const baseUrl = relayUrl.replace(/\/sync$/, '');
    this.manifestProvider = new WebsocketProvider(baseUrl, `sync/${vaultId}/__manifest__`, this.manifestDoc, {
      params: { token: userToken },
    });

    const initials = this.settings.displayName
      .split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U';

    this.presence.setAwareness(this.manifestProvider.awareness, {
      id: this.settings.userId,
      display_name: this.settings.displayName,
      color: this.settings.color,
      initials,
      activeFile: null,
    });

    // Watch the file-tree map for remote create/delete events
    const fileMap = this.manifestDoc.getMap<{ exists: boolean }>('files');
    const onFileMapChange = (event: Y.YMapEvent<{ exists: boolean }>) => {
      event.changes.keys.forEach(async (change, filePath) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = fileMap.get(filePath);
          if (val?.exists && !this.app.vault.getAbstractFileByPath(filePath)) {
            this.remoteFileOps.add(filePath);
            try {
              // Ensure parent folders exist
              const parts = filePath.split('/');
              if (parts.length > 1) {
                const folder = parts.slice(0, -1).join('/');
                if (!this.app.vault.getAbstractFileByPath(folder)) {
                  await this.app.vault.createFolder(folder);
                }
              }
              await this.app.vault.create(filePath, '');
            } catch { /* file may already exist due to race */ }
            this.remoteFileOps.delete(filePath);
            await this.connectFile(filePath);
          }
        } else if (change.action === 'delete') {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            this.remoteFileOps.add(filePath);
            try { await this.app.vault.delete(file); } catch { /* already gone */ }
            this.remoteFileOps.delete(filePath);
            this.disconnectFile(filePath);
          }
        }
      });
    };
    fileMap.observe(onFileMapChange);
    this.unsubscribers.push(() => fileMap.unobserve(onFileMapChange));
  }

  // ── Per-file rooms ─────────────────────────────────────────────────────────
  // ?room=<filePath> → relay docName = vaultId/<filePath>

  async connectFile(filePath: string) {
    if (!this.settings || this.providers.has(filePath)) return;
    const { relayUrl, vaultId, userToken } = this.settings;

    const doc = new Y.Doc();
    const yText = doc.getText('content');

    const baseUrl = relayUrl.replace(/\/sync$/, '');
    const provider = new WebsocketProvider(baseUrl, `sync/${vaultId}/${filePath}`, doc, {
      params: { token: userToken },
    });

    this.docs.set(filePath, doc);
    this.providers.set(filePath, provider);

    // On first sync: seed from local file if doc is empty; otherwise apply remote
    provider.on('sync', async (isSynced: boolean) => {
      if (!isSynced) return;
      await new Promise(r => setTimeout(r, 800));

      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;

      if (yText.toString() === '') {
        const localContent = await this.app.vault.read(file);
        if (localContent) {
          doc.transact(() => { yText.insert(0, localContent); }, LOCAL_ORIGIN);
        }
      } else {
        // Remote doc has content — apply it to local file
        const remoteContent = yText.toString();
        const localContent = await this.app.vault.read(file);
        if (remoteContent !== localContent) {
          await this.app.vault.modify(file, remoteContent);
        }
      }
    });

    // Remote update → patch local file
    doc.on('update', async (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;
      const remoteContent = yText.toString();
      const localContent = await this.app.vault.read(file);
      if (remoteContent !== localContent) {
        await this.app.vault.modify(file, remoteContent);
      }
    });

    return provider;
  }

  disconnectFile(filePath: string) {
    this.providers.get(filePath)?.destroy();
    this.providers.delete(filePath);
    this.docs.get(filePath)?.destroy();
    this.docs.delete(filePath);
  }

  // ── Vault event watchers ───────────────────────────────────────────────────

  private watchVault() {
    if (!this.settings) return;

    // Local file modified → push minimal diff into Yjs
    const onModify = async (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      const doc = this.docs.get(file.path);
      if (!doc) return;
      const yText = doc.getText('content');
      const newContent = await this.app.vault.read(file);
      const oldContent = yText.toString();
      if (newContent === oldContent) return;
      const { index, deleteCount, insertText } = minimalDiff(oldContent, newContent);
      doc.transact(() => {
        if (deleteCount > 0) yText.delete(index, deleteCount);
        if (insertText) yText.insert(index, insertText);
      }, LOCAL_ORIGIN);
    };
    this.app.vault.on('modify', onModify);
    this.unsubscribers.push(() => this.app.vault.off('modify', onModify));

    // Local file created → broadcast via manifest map + connect provider
    const onCreate = async (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path)) return; // skip remote-triggered creates
      const fileMap = this.manifestDoc?.getMap<{ exists: boolean }>('files');
      this.manifestDoc?.transact(() => {
        fileMap?.set(file.path, { exists: true });
      }, LOCAL_ORIGIN);
      await this.connectFile(file.path);
    };
    this.app.vault.on('create', onCreate);
    this.unsubscribers.push(() => this.app.vault.off('create', onCreate));

    // Local file deleted → remove from manifest map + disconnect
    const onDelete = (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path)) return; // skip remote-triggered deletes
      const fileMap = this.manifestDoc?.getMap<{ exists: boolean }>('files');
      this.manifestDoc?.transact(() => {
        fileMap?.delete(file.path);
      }, LOCAL_ORIGIN);
      this.disconnectFile(file.path);
    };
    this.app.vault.on('delete', onDelete);
    this.unsubscribers.push(() => this.app.vault.off('delete', onDelete));

    // Active file changed → update presence + connect provider lazily
    const onFileOpen = async (file: TFile | null) => {
      this.presence.setActiveFile(file?.path ?? null);
      if (file && !this.providers.has(file.path)) {
        await this.connectFile(file.path);
      }
    };
    this.app.workspace.on('file-open', onFileOpen);
    this.unsubscribers.push(() => this.app.workspace.off('file-open', onFileOpen));
  }

  stop() {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.manifestProvider?.destroy();
    this.manifestDoc?.destroy();
    for (const provider of this.providers.values()) provider.destroy();
    for (const doc of this.docs.values()) doc.destroy();
    this.providers.clear();
    this.docs.clear();
    this.presence.destroy();
  }
}
