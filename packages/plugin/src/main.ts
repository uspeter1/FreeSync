import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, Editor, Menu, MarkdownView } from 'obsidian';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncManager } from './sync';
import { PresenceManager } from './presence';
import { FreeSyncSidebarView, VIEW_TYPE_FREESYNC } from './sidebar';
import { AwarenessRef, remoteCursorsExtension, publishCursorExtension } from './cursors';
import { CommentsRef, commentsExtension } from './comments';
import { CommentsPanelView, VIEW_TYPE_COMMENTS } from './comments-panel';

interface FreeSyncSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  relayUrl: string;
  email: string;
  password: string;
  vaultId: string;
  enabled: boolean;
}

const DEFAULT_SETTINGS: FreeSyncSettings = {
  supabaseUrl: 'https://awgcorggtvfcnmjdcljb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTIwNjAsImV4cCI6MjA5MzU4ODA2MH0.Ymb_EpVaNxPZa4M-dgCIbw2t6taY8YEjA8pw9Q8n3cI',
  relayUrl: 'ws://localhost:3001/sync',
  email: '',
  password: '',
  vaultId: '',
  enabled: false,
};

export default class FreeSyncPlugin extends Plugin {
  settings!: FreeSyncSettings;
  private supabase!: SupabaseClient;
  syncManager!: SyncManager;
  private presenceManager!: PresenceManager;
  private statusBarEl!: HTMLElement;
  private awarenessRef: AwarenessRef = { awareness: null, localClientId: -1 };
  private commentsRef: CommentsRef = {
    getComments: null,
    localUser: null,
    focusComment: null,
    focusedCommentId: null,
    requestRedecorations: [],
    commentPositions: new Map(),
    draftCharOffset: null,
    editorMetrics: null,
    onPositionsUpdate: null,
  };

  async onload() {
    await this.loadSettings();

    this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.presenceManager = new PresenceManager(this.app);
    this.syncManager = new SyncManager(this.app, this.presenceManager);

    // Status bar item — hidden until a file with foreign last-editor metadata is active
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.style.display = 'none';

    // Register sidebar view
    this.registerView(VIEW_TYPE_FREESYNC, (leaf: WorkspaceLeaf) => new FreeSyncSidebarView(leaf));

    // Register comments panel view
    this.registerView(VIEW_TYPE_COMMENTS, (leaf: WorkspaceLeaf) => new CommentsPanelView(leaf));

    // Ribbon icon to open sidebar
    this.addRibbonIcon('users', 'FreeSync — show users', () => this.activateSidebarView());

    // Ribbon icon to open comments panel
    this.addRibbonIcon('message-square', 'FreeSync — show comments', () => this.activateCommentsPanel());

    // Register CM6 cursor extensions (awareness ref is populated after startSync)
    this.registerEditorExtension(remoteCursorsExtension(this.awarenessRef));
    this.registerEditorExtension(publishCursorExtension(this.awarenessRef));

    // Register CM6 comments extensions (commentsRef is populated after startSync)
    this.registerEditorExtension(commentsExtension(this.commentsRef));

    // Re-attach comments panel when switching to an already-connected file
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!file || !this.commentsRef.getComments || !this.commentsRef.localUser) return;
      const yComments = this.commentsRef.getComments(file.path);
      const awareness = this.syncManager.manifestProvider?.awareness;
      if (yComments && awareness) this.getCommentsPanelView()?.attach(yComments, this.commentsRef.localUser, awareness, this.commentsRef);
    }));

    // Right-click → Add comment (only shown when text is selected and sync is active)
    this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView) => {
      if (!editor.getSelection() || !this.commentsRef.getComments || !this.commentsRef.localUser) return;
      const filePath = info.file?.path;
      if (!filePath) return;

      const from = editor.posToOffset(editor.getCursor('from'));
      const to = editor.posToOffset(editor.getCursor('to'));

      menu.addItem((item) =>
        item
          .setTitle('Add comment')
          .setIcon('message-square')
          .onClick(async () => {
            await this.activateCommentsPanel();
            const panel = this.getCommentsPanelView();
            if (!panel) return;
            // Ensure panel is attached to this file before opening draft
            const yComments = this.commentsRef.getComments?.(filePath);
            const awareness = this.syncManager.manifestProvider?.awareness;
            if (yComments && awareness && this.commentsRef.localUser) {
              panel.attach(yComments, this.commentsRef.localUser, awareness, this.commentsRef);
            }
            panel.startDraft(from, to);
          })
      );
    }));

    this.addSettingTab(new FreeSyncSettingTab(this.app, this));

    if (this.settings.enabled && this.settings.email && this.settings.vaultId) {
      await this.startSync();
    }
  }

  private async activateSidebarView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_FREESYNC)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_FREESYNC, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private async activateCommentsPanel() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private getSidebarView(): FreeSyncSidebarView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FREESYNC)[0];
    return leaf ? (leaf.view as FreeSyncSidebarView) : null;
  }

  private getCommentsPanelView(): CommentsPanelView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0];
    return leaf ? (leaf.view as CommentsPanelView) : null;
  }

  async startSync() {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: this.settings.email,
        password: this.settings.password,
      });
      if (error || !data.session) {
        new Notice(`FreeSync: Sign in failed — ${error?.message}`);
        return;
      }
      const token = data.session.access_token;

      const user = (await this.supabase.auth.getUser(token)).data.user;
      if (!user) { new Notice('FreeSync: Could not get user'); return; }

      const { data: profile } = await this.supabase
        .from('profiles')
        .select('display_name, color')
        .eq('id', user.id)
        .single();

      await this.syncManager.start({
        relayUrl: this.settings.relayUrl,
        vaultId: this.settings.vaultId,
        userToken: token,
        userId: user.id,
        displayName: profile?.display_name ?? user.email ?? 'Unknown',
        color: profile?.color ?? '#7c5cfc',
        supabase: this.supabase,
      });

      // Wire status bar — shows last editor of the active file; click opens version history
      this.presenceManager.setStatusBar(this.statusBarEl, () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        new FreeSyncHistoryModal(
          this.app,
          activeFile.basename,
          this.syncManager.getHistorySnapshot(activeFile.path),
        ).open();
      });

      // Wire awareness ref for CM6 cursor extensions
      if (this.syncManager.manifestProvider) {
        const aw = this.syncManager.manifestProvider.awareness;
        this.awarenessRef.awareness = aw;
        this.awarenessRef.localClientId = aw.clientID;
      }

      // Wire commentsRef for CM6 comments extensions
      this.commentsRef.getComments = (path) => this.syncManager.getComments(path);
      this.commentsRef.localUser = {
        id: user.id,
        display_name: profile?.display_name ?? user.email ?? 'Unknown',
        color: profile?.color ?? '#7c5cfc',
      };
      this.commentsRef.focusComment = (commentId) => {
        this.getCommentsPanelView()?.focus(commentId);
      };

      // Wire panel to the currently active file
      const localUser = this.commentsRef.localUser;
      const awareness = this.syncManager.manifestProvider?.awareness;
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile && awareness) {
        const yComments = this.commentsRef.getComments(activeFile.path);
        if (yComments) this.getCommentsPanelView()?.attach(yComments, localUser, awareness, this.commentsRef);
      }

      // Update panel whenever a file's provider connects
      this.syncManager.onFileConnected = (filePath, yComments) => {
        const af = this.app.workspace.getActiveFile();
        if (af?.path === filePath && awareness) {
          this.getCommentsPanelView()?.attach(yComments, localUser, awareness, this.commentsRef);
        }
      };

      // Wire sidebar to live awareness
      const sidebar = this.getSidebarView();
      if (sidebar && this.syncManager.manifestProvider) {
        sidebar.attach(this.syncManager.manifestProvider.awareness, this.syncManager.manifestProvider.awareness.clientID);
      }

      new Notice('FreeSync: Connected');
    } catch (err) {
      new Notice(`FreeSync: Error — ${err}`);
      console.error('FreeSync startSync error:', err);
    }
  }

  async stopSync() {
    this.awarenessRef.awareness = null;
    this.commentsRef.getComments = null;
    this.commentsRef.localUser = null;
    this.commentsRef.focusComment = null;
    this.commentsRef.focusedCommentId = null;
    this.commentsRef.commentPositions.clear();
    this.commentsRef.draftCharOffset = null;
    this.commentsRef.editorMetrics = null;
    this.commentsRef.onPositionsUpdate = null;
    this.syncManager.onFileConnected = null;
    this.getSidebarView()?.detach();
    this.getCommentsPanelView()?.detach();
    this.syncManager.stop();
    new Notice('FreeSync: Disconnected');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    this.syncManager?.stop();
  }
}

// ── Version History Modal ─────────────────────────────────────────────────────

interface HistoryEntry {
  userId: string;
  display_name: string;
  color: string;
  timestamp: number;
  content: string;
}

class FreeSyncHistoryModal extends Modal {
  constructor(
    app: App,
    private fileName: string,
    private entries: HistoryEntry[],
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.width = '640px';
    modalEl.style.maxWidth = '92vw';

    contentEl.empty();
    contentEl.createEl('h3', { text: `Version history — ${this.fileName}`, cls: 'freesync-history-title' });

    if (this.entries.length === 0) {
      contentEl.createEl('p', {
        text: 'No snapshots yet. Edits are captured every 5 minutes.',
        cls: 'freesync-history-empty',
      });
      return;
    }

    const layout = contentEl.createDiv({ cls: 'freesync-history-layout' });
    const listEl = layout.createDiv({ cls: 'freesync-history-list' });
    const previewEl = layout.createDiv({ cls: 'freesync-history-preview' });
    previewEl.createEl('p', { text: 'Select a version to preview', cls: 'freesync-history-hint' });

    const sorted = [...this.entries].reverse(); // newest first

    for (const entry of sorted) {
      const item = listEl.createDiv({ cls: 'freesync-history-item' });

      const avatar = item.createEl('span', { cls: 'freesync-history-avatar' });
      avatar.textContent = (entry.display_name?.[0] ?? '?').toUpperCase();
      avatar.style.background = entry.color ?? '#7c5cfc';

      const meta = item.createDiv({ cls: 'freesync-history-meta' });
      meta.createEl('div', { text: entry.display_name ?? 'Unknown', cls: 'freesync-history-name' });
      meta.createEl('div', { text: FreeSyncHistoryModal.relativeTime(entry.timestamp), cls: 'freesync-history-time' });

      item.addEventListener('click', () => {
        listEl.querySelectorAll('.freesync-history-item').forEach(el => el.removeClass('selected'));
        item.addClass('selected');
        previewEl.empty();
        const pre = previewEl.createEl('pre', { cls: 'freesync-history-content' });
        pre.textContent = entry.content ?? '';
      });
    }
  }

  private static relativeTime(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

class FreeSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: FreeSyncPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'FreeSync Settings' });

    new Setting(containerEl).setName('Email').addText(t =>
      t.setValue(this.plugin.settings.email)
        .onChange(async v => { this.plugin.settings.email = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Password').addText(t => {
      t.inputEl.type = 'password';
      t.setValue(this.plugin.settings.password)
        .onChange(async v => { this.plugin.settings.password = v; await this.plugin.saveSettings(); });
    });

    new Setting(containerEl).setName('Vault ID').setDesc('UUID from FreeSync vault').addText(t =>
      t.setValue(this.plugin.settings.vaultId)
        .onChange(async v => { this.plugin.settings.vaultId = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Relay URL').addText(t =>
      t.setValue(this.plugin.settings.relayUrl)
        .onChange(async v => { this.plugin.settings.relayUrl = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Enable Sync').addToggle(t =>
      t.setValue(this.plugin.settings.enabled)
        .onChange(async v => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.startSync();
          else await this.plugin.stopSync();
        }));
  }
}

