import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, Editor, Menu, MarkdownView, requestUrl } from 'obsidian';
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
  private jwt: string | null = null;
  get currentJwt(): string | null { return this.jwt; }
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

    // Ribbon icon to share vault
    this.addRibbonIcon('share-2', 'FreeSync — share vault', () => {
      if (!this.jwt) { new Notice('FreeSync: Connect first to share'); return; }
      new FreeSyncShareModal(this.app, this.settings.vaultId, this.jwt, this.getRelayHttpBase()).open();
    });

    this.addCommand({
      id: 'share-vault',
      name: 'Share vault',
      callback: () => {
        if (!this.jwt) { new Notice('FreeSync: Connect first to share'); return; }
        new FreeSyncShareModal(this.app, this.settings.vaultId, this.jwt, this.getRelayHttpBase()).open();
      },
    });

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

  getRelayHttpBase(): string {
    const url = this.settings.relayUrl.replace(/\/sync\/?$/, '');
    return url.startsWith('wss://') ? url.replace('wss://', 'https://') : url.replace('ws://', 'http://');
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
      this.jwt = token;

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
    this.jwt = null;
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

// ── Share Modal ───────────────────────────────────────────────────────────────

class FreeSyncShareModal extends Modal {
  constructor(
    app: App,
    private vaultId: string,
    private jwt: string,
    private relayBase: string,
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.width = '520px';
    modalEl.style.maxWidth = '92vw';
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Share Vault', cls: 'freesync-share-title' });

    const loading = contentEl.createEl('p', { text: 'Loading invite code…', cls: 'freesync-share-desc' });

    try {
      const res = await requestUrl({
        url: `${this.relayBase}/vaults`,
        headers: { Authorization: `Bearer ${this.jwt}` },
        throw: false,
      });
      if (res.status !== 200) { loading.textContent = `Error ${res.status}: ${res.json?.error ?? 'relay error'}`; return; }
      const vaults: Array<{ id: string; invite_code: string; name: string; open_invite: boolean }> = res.json;
      const vault = vaults.find(v => v.id === this.vaultId);
      if (!vault) { loading.textContent = 'Vault not found. Make sure you are connected.'; return; }
      loading.remove();
      this.renderContent(vault.name, vault.invite_code, vault.open_invite ?? false);
    } catch (e) {
      loading.textContent = `Failed to load vault info: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private renderContent(vaultName: string, inviteCode: string, openInvite: boolean) {
    const { contentEl } = this;
    const shareCode = `${this.vaultId}/${inviteCode}`;

    // ── Mode selector tabs ────────────────────────────────────────────
    const modeRow = contentEl.createDiv();
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';

    const makeTab = (label: string) => {
      const btn = modeRow.createEl('button', { text: label });
      btn.style.cssText = 'flex:1;padding:8px 12px;border-radius:6px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:13px;transition:all 0.12s;';
      return btn;
    };
    const codeTab = makeTab('Anyone with the code');
    const emailTab = makeTab('Specific people');
    const codePanel = contentEl.createDiv();
    const emailPanel = contentEl.createDiv();

    const activateTab = (mode: 'code' | 'email') => {
      const isCode = mode === 'code';
      codePanel.style.display = isCode ? '' : 'none';
      emailPanel.style.display = isCode ? 'none' : '';
      codeTab.style.cssText += isCode
        ? ';background:var(--interactive-accent);color:#fff;border-color:var(--interactive-accent);'
        : ';background:;color:;border-color:var(--background-modifier-border);';
      emailTab.style.cssText += isCode
        ? ';background:;color:;border-color:var(--background-modifier-border);'
        : ';background:var(--interactive-accent);color:#fff;border-color:var(--interactive-accent);';
    };
    codeTab.addEventListener('click', () => activateTab('code'));
    emailTab.addEventListener('click', () => activateTab('email'));

    // ── "Anyone with the code" panel ──────────────────────────────────
    let currentOpenInvite = openInvite;

    const toggleRow = codePanel.createDiv();
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;';

    const toggleLabel = toggleRow.createEl('span');
    toggleLabel.style.cssText = 'flex:1;font-size:13px;';

    const toggleBtn = toggleRow.createEl('button');
    toggleBtn.style.cssText = 'padding:4px 14px;border-radius:12px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all 0.12s;';

    const codeDesc = codePanel.createEl('p', { cls: 'freesync-share-desc' });

    const codeRow = codePanel.createDiv({ cls: 'freesync-share-row' });
    codeRow.style.marginTop = '8px';
    const codeInput = codeRow.createEl('input', { cls: 'freesync-share-input' });
    codeInput.value = shareCode;
    codeInput.readOnly = true;
    codeInput.addEventListener('click', () => { if (currentOpenInvite) codeInput.select(); });

    const copyBtn = codeRow.createEl('button', { text: 'Copy', cls: 'mod-cta freesync-share-btn' });
    const toggleStatus = codePanel.createEl('p', { cls: 'freesync-share-desc' });
    toggleStatus.style.marginTop = '6px';

    const applyOpenInviteState = (enabled: boolean) => {
      currentOpenInvite = enabled;
      toggleLabel.textContent = enabled ? 'Anyone with the code can join' : 'Only people you invite can join';
      toggleBtn.textContent = enabled ? 'Enabled' : 'Enable code sharing';
      toggleBtn.style.background = enabled ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
      toggleBtn.style.color = enabled ? '#fff' : 'var(--text-muted)';
      codeDesc.textContent = enabled
        ? 'Anyone who pastes this code in FreeSync can join. You can disable this at any time.'
        : 'Code joining is off. Only people you add by email can join.';
      codeInput.style.opacity = enabled ? '1' : '0.4';
      (copyBtn as HTMLButtonElement).disabled = !enabled;
      copyBtn.style.opacity = enabled ? '1' : '0.4';
    };

    applyOpenInviteState(openInvite);

    toggleBtn.addEventListener('click', async () => {
      const next = !currentOpenInvite;
      (toggleBtn as HTMLButtonElement).disabled = true;
      toggleStatus.textContent = '';
      try {
        const res = await requestUrl({
          url: `${this.relayBase}/vaults/${this.vaultId}/open-invite`,
          method: 'PATCH',
          headers: { Authorization: `Bearer ${this.jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
          throw: false,
        });
        if (res.status === 200) {
          applyOpenInviteState(next);
        } else {
          toggleStatus.textContent = `Error: ${res.json?.error ?? 'Unknown error'}`;
        }
      } catch (e) {
        toggleStatus.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      (toggleBtn as HTMLButtonElement).disabled = false;
    });

    copyBtn.addEventListener('click', () => {
      if (!currentOpenInvite) return;
      navigator.clipboard.writeText(shareCode);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });

    // ── "Specific people" panel ───────────────────────────────────────
    emailPanel.createEl('p', {
      text: 'Add a collaborator by email. They must already have a FreeSync account. Only people you add can join.',
      cls: 'freesync-share-desc',
    });

    const emailRow = emailPanel.createDiv({ cls: 'freesync-share-row' });
    emailRow.style.marginTop = '10px';
    const emailInput = emailRow.createEl('input', { cls: 'freesync-share-input', type: 'email' });
    emailInput.placeholder = 'colleague@example.com';

    const addBtn = emailRow.createEl('button', { text: 'Add member', cls: 'mod-cta freesync-share-btn' });
    const statusEl = emailPanel.createEl('p', { cls: 'freesync-share-desc' });
    statusEl.style.marginTop = '8px';

    addBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) return;
      addBtn.textContent = 'Adding…';
      (addBtn as HTMLButtonElement).disabled = true;
      statusEl.textContent = '';
      try {
        const res = await requestUrl({
          url: `${this.relayBase}/vaults/${this.vaultId}/invite`,
          method: 'POST',
          headers: { Authorization: `Bearer ${this.jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          throw: false,
        });
        if (res.status === 200) {
          statusEl.textContent = res.json.signup_required
            ? `✓ Invite sent to ${email}. They'll be automatically added to your vault once they sign up.`
            : `✓ ${email} has been added to your vault.`;
          emailInput.value = '';
        } else {
          statusEl.textContent = `Error: ${res.json?.error ?? 'Unknown error'}`;
        }
      } catch (e) {
        statusEl.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      addBtn.textContent = 'Add member';
      (addBtn as HTMLButtonElement).disabled = false;
    });

    activateTab('code');
  }

  onClose() { this.contentEl.empty(); }
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

    const isEmpty = this.plugin.app.vault.getFiles().length === 0;

    // ── Credentials (always shown) ──────────────────────────────────────────
    new Setting(containerEl).setName('Email').addText(t =>
      t.setValue(this.plugin.settings.email)
        .onChange(async v => { this.plugin.settings.email = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Password').addText(t => {
      t.inputEl.type = 'password';
      t.setValue(this.plugin.settings.password)
        .onChange(async v => { this.plugin.settings.password = v; await this.plugin.saveSettings(); });
    });

    new Setting(containerEl).setName('Relay URL').addText(t =>
      t.setValue(this.plugin.settings.relayUrl)
        .onChange(async v => { this.plugin.settings.relayUrl = v; await this.plugin.saveSettings(); }));

    if (isEmpty) {
      // ── Empty vault: Join flow ────────────────────────────────────────────
      containerEl.createEl('h3', { text: 'Join a Shared Vault', cls: 'freesync-settings-section' });
      containerEl.createEl('p', {
        text: 'Paste an invite code from a vault owner. All their files will sync to your vault automatically.',
        cls: 'setting-item-description',
      });

      let joinCode = '';
      const joinRow = containerEl.createDiv({ cls: 'freesync-join-row' });
      const joinInput = joinRow.createEl('input', { cls: 'freesync-share-input' });
      joinInput.placeholder = 'Paste invite code here';
      joinInput.addEventListener('input', () => { joinCode = joinInput.value.trim(); });

      const joinBtn = joinRow.createEl('button', { text: 'Join Vault', cls: 'mod-cta freesync-share-btn' });
      joinBtn.addEventListener('click', async () => {
        if (!joinCode) { new Notice('Paste an invite code first'); return; }
        const slashIdx = joinCode.indexOf('/');
        if (slashIdx < 1) { new Notice('Invalid invite code — expected vaultId/inviteCode'); return; }
        const vaultId = joinCode.slice(0, slashIdx);
        const inviteCode = joinCode.slice(slashIdx + 1);

        if (!this.plugin.settings.email || !this.plugin.settings.password) {
          new Notice('Enter email and password above first'); return;
        }

        joinBtn.textContent = 'Joining…';
        (joinBtn as HTMLButtonElement).disabled = true;

        try {
          const supabase = createClient(
            this.plugin.settings.supabaseUrl,
            this.plugin.settings.supabaseAnonKey,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const { data, error } = await supabase.auth.signInWithPassword({
            email: this.plugin.settings.email,
            password: this.plugin.settings.password,
          });
          if (error || !data.session) {
            new Notice(`Sign in failed: ${error?.message}`);
            joinBtn.textContent = 'Join Vault';
            (joinBtn as HTMLButtonElement).disabled = false;
            return;
          }

          const token = data.session.access_token;
          const relayBase = this.plugin.getRelayHttpBase();
          const res = await requestUrl({
            url: `${relayBase}/vaults/${vaultId}/join`,
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ invite_code: inviteCode }),
            throw: false,
          });
          const json = res.json;
          if (res.status !== 200) {
            new Notice(`Failed to join: ${json.error}`);
            joinBtn.textContent = 'Join Vault';
            (joinBtn as HTMLButtonElement).disabled = false;
            return;
          }

          this.plugin.settings.vaultId = vaultId;
          this.plugin.settings.enabled = true;
          await this.plugin.saveSettings();
          await this.plugin.startSync();
          joinBtn.textContent = '✓ Joined';
          new Notice('Joined! Files are syncing to your vault…');
        } catch (e) {
          new Notice(`Error: ${e}`);
          joinBtn.textContent = 'Join Vault';
          (joinBtn as HTMLButtonElement).disabled = false;
        }
      });

    } else {
      // ── Non-empty vault: settings + inline share ──────────────────────────
      new Setting(containerEl).setName('Vault ID').setDesc('UUID from FreeSync vault').addText(t =>
        t.setValue(this.plugin.settings.vaultId)
          .onChange(async v => { this.plugin.settings.vaultId = v; await this.plugin.saveSettings(); }));

      new Setting(containerEl).setName('Enable Sync').addToggle(t =>
        t.setValue(this.plugin.settings.enabled)
          .onChange(async v => {
            this.plugin.settings.enabled = v;
            await this.plugin.saveSettings();
            if (v) await this.plugin.startSync();
            else await this.plugin.stopSync();
          }));

      // ── Share section ──────────────────────────────────────────────────────
      containerEl.createEl('h3', { text: 'Share Vault', cls: 'freesync-settings-section' });
      containerEl.createEl('p', {
        text: 'Share your vault with collaborators. They paste the code in a fresh Obsidian vault.',
        cls: 'setting-item-description',
      });

      const shareArea = containerEl.createDiv({ cls: 'freesync-share-area' });
      if (this.plugin.currentJwt) {
        this.renderShareCode(shareArea);
      } else {
        shareArea.createEl('p', {
          text: 'Enable sync above to see your invite code.',
          cls: 'freesync-share-desc',
        });
      }
    }
  }

  private async renderShareCode(container: HTMLElement) {
    const loading = container.createEl('p', { text: 'Loading invite code…', cls: 'freesync-share-desc' });
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        headers: { Authorization: `Bearer ${this.plugin.currentJwt}` },
        throw: false,
      });
      if (res.status !== 200) {
        loading.textContent = `Error ${res.status}: ${res.json?.error ?? 'relay error'}`;
        console.error('FreeSync share: GET /vaults failed', res.status, res.json);
        return;
      }
      const vaults: Array<{ id: string; invite_code: string; name: string; open_invite: boolean }> = res.json;
      const vault = vaults.find(v => v.id === this.plugin.settings.vaultId);
      if (!vault) {
        loading.textContent = `Vault not found in your account (ID: ${this.plugin.settings.vaultId.slice(0, 8)}…). Check Vault ID in settings.`;
        console.error('FreeSync share: vault not in list', this.plugin.settings.vaultId, vaults.map(v => v.id));
        return;
      }
      loading.remove();

      const shareCode = `${vault.id}/${vault.invite_code}`;
      const relayBase = this.plugin.getRelayHttpBase();
      const vaultId = this.plugin.settings.vaultId;
      const jwt = this.plugin.currentJwt!;

      // ── Mode tabs ──────────────────────────────────────────────────
      const modeRow = container.createDiv();
      modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';

      const makeTab = (label: string) => {
        const btn = modeRow.createEl('button', { text: label });
        btn.style.cssText = 'flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:12px;transition:all 0.12s;';
        return btn;
      };
      const codeTab = makeTab('Anyone with the code');
      const emailTab = makeTab('Specific people');
      const codePanel = container.createDiv();
      const emailPanel = container.createDiv();

      const activateTab = (mode: 'code' | 'email') => {
        const isCode = mode === 'code';
        codePanel.style.display = isCode ? '' : 'none';
        emailPanel.style.display = isCode ? 'none' : '';
        codeTab.style.background = isCode ? 'var(--interactive-accent)' : '';
        codeTab.style.color = isCode ? '#fff' : '';
        codeTab.style.borderColor = isCode ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        emailTab.style.background = isCode ? '' : 'var(--interactive-accent)';
        emailTab.style.color = isCode ? '' : '#fff';
        emailTab.style.borderColor = isCode ? 'var(--background-modifier-border)' : 'var(--interactive-accent)';
      };
      codeTab.addEventListener('click', () => activateTab('code'));
      emailTab.addEventListener('click', () => activateTab('email'));

      // Code panel — with open_invite toggle
      let currentOpenInvite = vault.open_invite ?? false;

      const toggleRow = codePanel.createDiv();
      toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
      const toggleLabel = toggleRow.createEl('span');
      toggleLabel.style.cssText = 'flex:1;font-size:12px;';
      const toggleBtn = toggleRow.createEl('button');
      toggleBtn.style.cssText = 'padding:3px 12px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;border:none;transition:all 0.12s;';
      const codeDesc = codePanel.createEl('p', { cls: 'freesync-share-desc' });
      const codeRow = codePanel.createDiv({ cls: 'freesync-share-row' });
      codeRow.style.marginTop = '6px';
      const codeInput = codeRow.createEl('input', { cls: 'freesync-share-input' });
      codeInput.value = shareCode;
      codeInput.readOnly = true;
      const copyBtn = codeRow.createEl('button', { text: 'Copy', cls: 'mod-cta freesync-share-btn' });
      const toggleStatus = codePanel.createEl('p', { cls: 'freesync-share-desc' });
      toggleStatus.style.marginTop = '4px';

      const applyOpenInviteState = (enabled: boolean) => {
        currentOpenInvite = enabled;
        toggleLabel.textContent = enabled ? 'Anyone with the code can join' : 'Only invited people can join';
        toggleBtn.textContent = enabled ? 'Enabled' : 'Enable code sharing';
        toggleBtn.style.background = enabled ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        toggleBtn.style.color = enabled ? '#fff' : 'var(--text-muted)';
        codeDesc.textContent = enabled
          ? 'Anyone who pastes this code in FreeSync can join. Disable to prevent new code joins.'
          : 'Code joining is off. Use "Specific people" to add collaborators directly.';
        codeInput.style.opacity = enabled ? '1' : '0.4';
        (copyBtn as HTMLButtonElement).disabled = !enabled;
        copyBtn.style.opacity = enabled ? '1' : '0.4';
      };
      applyOpenInviteState(currentOpenInvite);

      toggleBtn.addEventListener('click', async () => {
        const next = !currentOpenInvite;
        (toggleBtn as HTMLButtonElement).disabled = true;
        toggleStatus.textContent = '';
        try {
          const r = await requestUrl({
            url: `${relayBase}/vaults/${vaultId}/open-invite`,
            method: 'PATCH',
            headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
            throw: false,
          });
          if (r.status === 200) applyOpenInviteState(next);
          else toggleStatus.textContent = `Error: ${r.json?.error ?? 'Unknown error'}`;
        } catch (e) {
          toggleStatus.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        (toggleBtn as HTMLButtonElement).disabled = false;
      });

      codeInput.addEventListener('click', () => { if (currentOpenInvite) codeInput.select(); });
      copyBtn.addEventListener('click', () => {
        if (!currentOpenInvite) return;
        navigator.clipboard.writeText(shareCode);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });

      // Email panel
      const emailRow = emailPanel.createDiv({ cls: 'freesync-share-row' });
      const emailInput = emailRow.createEl('input', { cls: 'freesync-share-input', type: 'email' });
      emailInput.placeholder = 'colleague@example.com';

      const addBtn = emailRow.createEl('button', { text: 'Add', cls: 'mod-cta freesync-share-btn' });
      const statusEl = emailPanel.createEl('p', { cls: 'freesync-share-desc' });
      statusEl.style.marginTop = '6px';

      addBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        addBtn.textContent = 'Adding…';
        (addBtn as HTMLButtonElement).disabled = true;
        statusEl.textContent = '';
        try {
          const r = await requestUrl({
            url: `${relayBase}/vaults/${vaultId}/invite`,
            method: 'POST',
            headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
            throw: false,
          });
          if (r.status === 200) {
            statusEl.textContent = r.json.signup_required
              ? `✓ Invite sent to ${email}. They'll be automatically added to your vault once they sign up.`
              : `✓ ${email} added to vault.`;
            emailInput.value = '';
          } else {
            statusEl.textContent = `Error: ${r.json?.error ?? 'Unknown error'}`;
          }
        } catch (e) {
          statusEl.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        addBtn.textContent = 'Add';
        (addBtn as HTMLButtonElement).disabled = false;
      });
      emailPanel.createEl('p', {
        text: 'Only people you add can join. They must already have a FreeSync account.',
        cls: 'freesync-share-desc',
      }).style.marginTop = '6px';

      activateTab('code');
    } catch (e) {
      loading.textContent = `Failed to reach relay: ${e instanceof Error ? e.message : String(e)}`;
      console.error('FreeSync share: fetch error', e);
    }
  }
}

