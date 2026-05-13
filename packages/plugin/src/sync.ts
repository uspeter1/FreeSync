import { App, TFile, TAbstractFile } from 'obsidian';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { SupabaseClient } from '@supabase/supabase-js';
import { PresenceManager } from './presence';
import { minimalDiff } from './diff';

const LOCAL_ORIGIN = 'local';
const STORAGE_BUCKET = 'vault-assets';

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'pdf', 'mp3', 'mp4', 'mov', 'avi', 'wav',
  'zip', 'tar', 'gz', 'xlsx', 'docx', 'pptx',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

function contentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    ico: 'image/x-icon', pdf: 'application/pdf',
    mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', wav: 'audio/wav',
  };
  return map[ext] ?? 'application/octet-stream';
}

export interface SyncSettings {
  relayUrl: string;
  vaultId: string;
  userToken: string;
  userId: string;
  displayName: string;
  color: string;
  supabase: SupabaseClient;
}

// Shape stored per file in the manifest Y.Map
type FileEntry = {
  exists: boolean;
  renamedFrom?: string;
  lastEditedBy?: { userId: string; display_name: string; color: string };
  lastEditedAt?: number;
  binary?: boolean;
  storageKey?: string;
  binaryVersion?: number;
};

export class SyncManager {
  providers = new Map<string, WebsocketProvider>();
  private docs = new Map<string, Y.Doc>();
  private commentsMaps = new Map<string, Y.Map<Y.Map<any>>>();
  manifestDoc: Y.Doc | null = null;
  manifestProvider: WebsocketProvider | null = null;
  private unsubscribers: (() => void)[] = [];
  private settings: SyncSettings | null = null;
  private remoteFileOps = new Set<string>();
  // storageKeys we just uploaded — prevents re-download loop
  private recentlyUploaded = new Set<string>();
  onFileConnected: ((filePath: string, yComments: Y.Map<Y.Map<any>>) => void) | null = null;

  constructor(private app: App, private presence: PresenceManager) {}

  getComments(filePath: string): Y.Map<Y.Map<any>> | null {
    return this.commentsMaps.get(filePath) ?? null;
  }

  getHistorySnapshot(filePath: string): Array<{ userId: string; display_name: string; color: string; timestamp: number; content: string }> {
    const doc = this.docs.get(filePath);
    if (!doc) return [];
    const yHistory = doc.getArray<any>('history');
    const entries = [];
    for (let i = 0; i < yHistory.length; i++) entries.push(yHistory.get(i));
    return entries;
  }

  async start(settings: SyncSettings) {
    this.settings = settings;
    await this.connectManifest();
    this.watchVault();
    const activeFile = this.app.workspace.getActiveFile();
    this.presence.setActiveFile(activeFile?.path ?? null);
    if (activeFile && !isBinaryFile(activeFile.path)) await this.connectFile(activeFile.path);
  }

  // ── Manifest room ──────────────────────────────────────────────────────────

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

    // Force badge re-render after the initial awareness sync completes.
    // The awareness 'change' event only fires for delta changes — if a remote
    // client's state was already cached locally, no event fires on reconnect.
    this.manifestProvider.on('sync', (isSynced: boolean) => {
      if (isSynced) setTimeout(() => this.presence.forceRefresh(), 150);
    });

    const fileMap = this.manifestDoc.getMap<FileEntry>('files');
    const onFileMapChange = (event: Y.YMapEvent<FileEntry>) => {
      const renamedFromPaths = new Set<string>();
      event.changes.keys.forEach((change, filePath) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = fileMap.get(filePath);
          if (val?.exists && val.renamedFrom) renamedFromPaths.add(val.renamedFrom);
        }
      });

      event.changes.keys.forEach(async (change, filePath) => {
        if (change.action === 'add' || change.action === 'update') {
          const val = fileMap.get(filePath);
          if (!val?.exists) return;

          // Propagate last-edited metadata to status bar
          if (val.lastEditedBy && val.lastEditedAt) {
            this.presence.setFileMetadata(filePath, {
              lastEditedBy: val.lastEditedBy,
              lastEditedAt: val.lastEditedAt,
            });
          }

          // Binary file — download from Supabase Storage
          if (val.binary && val.storageKey) {
            if (val.renamedFrom) {
              const oldFile = this.app.vault.getAbstractFileByPath(val.renamedFrom);
              this.remoteFileOps.add(filePath);
              this.remoteFileOps.add(val.renamedFrom);
              try {
                if (oldFile instanceof TFile) {
                  await this.app.fileManager.renameFile(oldFile, filePath);
                } else if (!this.app.vault.getAbstractFileByPath(filePath)) {
                  this.remoteFileOps.delete(filePath);
                  this.remoteFileOps.delete(val.renamedFrom);
                  await this.downloadBinaryFile(filePath, val.storageKey, true);
                  return;
                }
              } catch { /* race */ }
              this.remoteFileOps.delete(filePath);
              this.remoteFileOps.delete(val.renamedFrom);
            } else {
              await this.downloadBinaryFile(filePath, val.storageKey, change.action === 'update');
            }
            return;
          }

          // Text file rename
          if (val.renamedFrom) {
            const oldFile = this.app.vault.getAbstractFileByPath(val.renamedFrom);
            this.remoteFileOps.add(filePath);
            this.remoteFileOps.add(val.renamedFrom);
            try {
              if (oldFile instanceof TFile) {
                await this.app.fileManager.renameFile(oldFile, filePath);
              } else if (!this.app.vault.getAbstractFileByPath(filePath)) {
                await this.app.vault.create(filePath, '');
              }
            } catch { /* race */ }
            this.remoteFileOps.delete(filePath);
            this.remoteFileOps.delete(val.renamedFrom);
            this.disconnectFile(val.renamedFrom);
            await this.connectFile(filePath);
          } else if (!this.app.vault.getAbstractFileByPath(filePath)) {
            // Text file create
            this.remoteFileOps.add(filePath);
            try {
              const parts = filePath.split('/');
              if (parts.length > 1) {
                const folder = parts.slice(0, -1).join('/');
                if (!this.app.vault.getAbstractFileByPath(folder))
                  await this.app.vault.createFolder(folder);
              }
              await this.app.vault.create(filePath, '');
            } catch { /* already exists */ }
            this.remoteFileOps.delete(filePath);
            await this.connectFile(filePath);
          }
        } else if (change.action === 'delete') {
          if (renamedFromPaths.has(filePath)) return;
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

  // ── Per-file rooms (text only) ─────────────────────────────────────────────

  async connectFile(filePath: string) {
    if (!this.settings || this.providers.has(filePath)) return;
    if (isBinaryFile(filePath)) return;
    const { relayUrl, vaultId, userToken } = this.settings;

    const doc = new Y.Doc();
    const yText = doc.getText('content');
    const yComments = doc.getMap<Y.Map<any>>('comments');

    const baseUrl = relayUrl.replace(/\/sync$/, '');
    const provider = new WebsocketProvider(baseUrl, `sync/${vaultId}/${filePath}`, doc, {
      params: { token: userToken },
    });

    this.docs.set(filePath, doc);
    this.providers.set(filePath, provider);
    this.commentsMaps.set(filePath, yComments);
    this.onFileConnected?.(filePath, yComments);

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
        const remoteContent = yText.toString();
        const localContent = await this.app.vault.read(file);
        if (remoteContent !== localContent) {
          await this.app.vault.modify(file, remoteContent);
        }
      }
    });

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
    this.commentsMaps.delete(filePath);
  }

  // ── Binary file storage (Supabase) ─────────────────────────────────────────
  /*
   * Supabase setup required (run once in SQL editor):
   *
   *   insert into storage.buckets (id, name, public)
   *   values ('vault-assets', 'vault-assets', false)
   *   on conflict do nothing;
   *
   *   create policy "vault members read"  on storage.objects for select using (auth.role() = 'authenticated');
   *   create policy "vault members write" on storage.objects for insert with check (auth.role() = 'authenticated');
   *   create policy "vault members update" on storage.objects for update using (auth.role() = 'authenticated');
   *   create policy "vault members delete" on storage.objects for delete using (auth.role() = 'authenticated');
   */

  private async uploadBinaryFile(file: TFile): Promise<void> {
    if (!this.settings) return;
    const storageKey = `${this.settings.vaultId}/${file.path}`;
    try {
      const buffer = await this.app.vault.readBinary(file);
      const { error } = await this.settings.supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storageKey, buffer, { upsert: true, contentType: contentType(file.path) });
      if (error) { console.error('[FreeSync] Storage upload failed:', error.message); return; }
      this.recentlyUploaded.add(storageKey);
      setTimeout(() => this.recentlyUploaded.delete(storageKey), 10_000);
      const fileMap = this.manifestDoc?.getMap<FileEntry>('files');
      const existing: FileEntry = fileMap?.get(file.path) ?? { exists: true };
      this.manifestDoc?.transact(() => {
        fileMap?.set(file.path, { ...existing, binary: true, storageKey, binaryVersion: Date.now() });
      }, LOCAL_ORIGIN);
    } catch (err) {
      console.error('[FreeSync] Storage upload error:', err);
    }
  }

  private async downloadBinaryFile(filePath: string, storageKey: string, forceDownload = false): Promise<void> {
    if (!this.settings) return;
    if (this.recentlyUploaded.has(storageKey)) return;
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (!forceDownload && existing instanceof TFile && existing.stat.size > 0) return;
    try {
      const { data, error } = await this.settings.supabase.storage
        .from(STORAGE_BUCKET)
        .download(storageKey);
      if (error || !data) { console.error('[FreeSync] Storage download failed:', error?.message); return; }
      const buffer = await data.arrayBuffer();
      this.remoteFileOps.add(filePath);
      try {
        if (existing instanceof TFile) {
          await this.app.vault.modifyBinary(existing, buffer);
        } else {
          const parts = filePath.split('/');
          if (parts.length > 1) {
            const folder = parts.slice(0, -1).join('/');
            if (!this.app.vault.getAbstractFileByPath(folder))
              await this.app.vault.createFolder(folder);
          }
          await this.app.vault.createBinary(filePath, buffer);
        }
      } catch (e) {
        console.error('[FreeSync] Vault binary write failed:', e);
      }
      this.remoteFileOps.delete(filePath);
    } catch (err) {
      console.error('[FreeSync] Storage download error:', err);
      this.remoteFileOps.delete(filePath);
    }
  }

  // ── Vault event watchers ───────────────────────────────────────────────────

  private watchVault() {
    if (!this.settings) return;

    const onModify = async (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path)) return;

      // Binary: re-upload to storage
      if (isBinaryFile(file.path)) {
        await this.uploadBinaryFile(file);
        return;
      }

      // Text: Yjs minimal diff
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

      // Update manifest last-edited metadata
      if (this.manifestDoc) {
        const fileMap = this.manifestDoc.getMap<FileEntry>('files');
        const existing: FileEntry = fileMap.get(file.path) ?? { exists: true };
        this.manifestDoc.transact(() => {
          fileMap.set(file.path, {
            ...existing,
            lastEditedBy: {
              userId: this.settings!.userId,
              display_name: this.settings!.displayName,
              color: this.settings!.color,
            },
            lastEditedAt: Date.now(),
          });
        }, LOCAL_ORIGIN);
      }

      // History snapshot — at most once per 5 minutes
      const yHistory = doc.getArray<any>('history');
      const last = yHistory.length > 0 ? yHistory.get(yHistory.length - 1) : null;
      if (!last || Date.now() - last.timestamp > 5 * 60 * 1000) {
        const entry = {
          userId: this.settings!.userId,
          display_name: this.settings!.displayName,
          color: this.settings!.color,
          timestamp: Date.now(),
          content: newContent,
        };
        doc.transact(() => {
          if (yHistory.length >= 20) yHistory.delete(0, 1);
          yHistory.push([entry]);
        }, LOCAL_ORIGIN);
      }
    };
    this.app.vault.on('modify', onModify);
    this.unsubscribers.push(() => this.app.vault.off('modify', onModify));

    const onCreate = async (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path)) return;

      if (isBinaryFile(file.path)) {
        await this.uploadBinaryFile(file);
        return;
      }

      const fileMap = this.manifestDoc?.getMap<FileEntry>('files');
      this.manifestDoc?.transact(() => {
        fileMap?.set(file.path, { exists: true });
      }, LOCAL_ORIGIN);
      await this.connectFile(file.path);
    };
    this.app.vault.on('create', onCreate);
    this.unsubscribers.push(() => this.app.vault.off('create', onCreate));

    const onRename = async (file: TAbstractFile, oldPath: string) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path) || this.remoteFileOps.has(oldPath)) return;
      const activePath = this.app.workspace.getActiveFile()?.path;
      if (activePath === file.path || activePath === oldPath)
        this.presence.setActiveFile(file.path);

      if (isBinaryFile(file.path) && this.settings) {
        // Supabase Storage has no rename — copy to new key, delete old
        const oldKey = `${this.settings.vaultId}/${oldPath}`;
        const newKey = `${this.settings.vaultId}/${file.path}`;
        try {
          const { data } = await this.settings.supabase.storage.from(STORAGE_BUCKET).download(oldKey);
          if (data) {
            const buffer = await data.arrayBuffer();
            await this.settings.supabase.storage.from(STORAGE_BUCKET)
              .upload(newKey, buffer, { upsert: true, contentType: contentType(file.path) });
            this.recentlyUploaded.add(newKey);
            setTimeout(() => this.recentlyUploaded.delete(newKey), 10_000);
            await this.settings.supabase.storage.from(STORAGE_BUCKET).remove([oldKey]);
          }
        } catch (err) {
          console.error('[FreeSync] Storage rename failed:', err);
        }
        const fileMap = this.manifestDoc?.getMap<FileEntry>('files');
        this.manifestDoc?.transact(() => {
          fileMap?.delete(oldPath);
          fileMap?.set(file.path, { exists: true, binary: true, storageKey: newKey, renamedFrom: oldPath, binaryVersion: Date.now() });
        }, LOCAL_ORIGIN);
        return;
      }

      const fileMap = this.manifestDoc?.getMap<FileEntry>('files');
      this.manifestDoc?.transact(() => {
        fileMap?.delete(oldPath);
        fileMap?.set(file.path, { exists: true, renamedFrom: oldPath });
      }, LOCAL_ORIGIN);
      this.disconnectFile(oldPath);
      await this.connectFile(file.path);
    };
    this.app.vault.on('rename', onRename);
    this.unsubscribers.push(() => this.app.vault.off('rename', onRename));

    const onDelete = (file: TAbstractFile) => {
      if (!(file instanceof TFile)) return;
      if (this.remoteFileOps.has(file.path)) return;
      if (isBinaryFile(file.path) && this.settings) {
        const storageKey = `${this.settings.vaultId}/${file.path}`;
        this.settings.supabase.storage.from(STORAGE_BUCKET).remove([storageKey])
          .catch(err => console.error('[FreeSync] Storage delete failed:', err));
      }
      const fileMap = this.manifestDoc?.getMap<FileEntry>('files');
      this.manifestDoc?.transact(() => {
        fileMap?.delete(file.path);
      }, LOCAL_ORIGIN);
      this.disconnectFile(file.path);
    };
    this.app.vault.on('delete', onDelete);
    this.unsubscribers.push(() => this.app.vault.off('delete', onDelete));

    let clearPresenceTimer: ReturnType<typeof setTimeout> | null = null;
    const onFileOpen = async (file: TFile | null) => {
      if (file) {
        if (clearPresenceTimer) { clearTimeout(clearPresenceTimer); clearPresenceTimer = null; }
        this.presence.setActiveFile(file.path);
        if (!this.providers.has(file.path) && !isBinaryFile(file.path)) {
          await this.connectFile(file.path);
        }
      } else {
        clearPresenceTimer = setTimeout(() => {
          clearPresenceTimer = null;
          this.presence.setActiveFile(null);
        }, 300);
      }
    };
    this.app.workspace.on('file-open', onFileOpen);
    this.unsubscribers.push(() => {
      if (clearPresenceTimer) clearTimeout(clearPresenceTimer);
      this.app.workspace.off('file-open', onFileOpen);
    });
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
    this.commentsMaps.clear();
    this.recentlyUploaded.clear();
    this.presence.destroy();
  }
}
