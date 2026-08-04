import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, WorkspaceLeaf, Editor, Menu, MarkdownView, requestUrl } from 'obsidian';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncManager } from './sync';
import { PresenceManager } from './presence';
import { FreeSyncSidebarView, VIEW_TYPE_FREESYNC } from './sidebar';
import { AwarenessRef, remoteCursorsExtension, publishCursorExtension } from './cursors';
import { remoteEditPulseExtension } from './remote-edit-pulse';
import { CanvasCursorManager } from './canvas-cursors';
import { renderShareUI } from './share';
import { CommentsRef, commentsExtension } from './comments';
import { CommentsPanelView, VIEW_TYPE_COMMENTS } from './comments-panel';

// Injected by esbuild at build time (see packages/plugin/esbuild.config.mjs).
// Set in packages/plugin/.env or override inline:
//   WEB_APP_URL=... RELAY_URL=... npm run build --workspace=packages/plugin
declare const __WEB_APP_URL__: string;
declare const __RELAY_URL__: string;

interface FreeSyncSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  relayUrl: string;
  webAppUrl: string;
  email: string;
  password: string;
  vaultId: string;
  enabled: boolean;
}

const DEFAULT_SETTINGS: FreeSyncSettings = {
  supabaseUrl: 'https://awgcorggtvfcnmjdcljb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTIwNjAsImV4cCI6MjA5MzU4ODA2MH0.Ymb_EpVaNxPZa4M-dgCIbw2t6taY8YEjA8pw9Q8n3cI',
  relayUrl: __RELAY_URL__,
  webAppUrl: __WEB_APP_URL__,
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
  private awarenessRef: AwarenessRef = { awareness: null, localClientId: -1, localUserId: null };
  private canvasCursors!: CanvasCursorManager;
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
      // persistSession stays false — that's what prevents Electron-vault
      // session bleed via localStorage. autoRefreshToken is safe because
      // it only refreshes the in-memory session; without it, the plugin's
      // JWT expires ~1h after sign-in and every subsequent Supabase call
      // (Storage uploads especially) starts silently 401ing.
      auth: { persistSession: false, autoRefreshToken: true },
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
      new FreeSyncShareModal(this.app, this).open();
    });

    this.addCommand({
      id: 'share-vault',
      name: 'Share vault',
      callback: () => {
        if (!this.jwt) { new Notice('FreeSync: Connect first to share'); return; }
        new FreeSyncShareModal(this.app, this).open();
      },
    });

    // Register CM6 cursor extensions (awareness ref is populated after startSync)
    this.registerEditorExtension(remoteCursorsExtension(this.awarenessRef));
    this.registerEditorExtension(publishCursorExtension(this.awarenessRef));

    // Brief fade highlight on ranges that arrived from other collaborators —
    // makes batched remote inserts feel like live typing.
    this.registerEditorExtension(remoteEditPulseExtension());

    // Canvas cursor overlay — started once awareness is wired in startSync().
    this.canvasCursors = new CanvasCursorManager(this.app, this.awarenessRef);

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
        supabaseUrl: this.settings.supabaseUrl,
        supabaseAnonKey: this.settings.supabaseAnonKey,
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
        this.awarenessRef.localUserId = user.id;
      }

      // Start canvas cursor overlay now that awareness is wired
      this.canvasCursors.start();

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
    this.canvasCursors?.stop();
    this.awarenessRef.awareness = null;
    this.awarenessRef.localUserId = null;
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
    this.canvasCursors?.stop();
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
// Thin wrapper around renderShareUI (share.ts). Shared behavior with the
// inline settings-tab share section.

class FreeSyncShareModal extends Modal {
  constructor(app: App, private plugin: FreeSyncPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.style.width = '520px';
    modalEl.style.maxWidth = '92vw';
    contentEl.empty();
    contentEl.style.padding = '18px 22px 22px';
    renderShareUI(contentEl, this.plugin);
  }

  onClose() { this.contentEl.empty(); }
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

interface RemoteVaultSummary {
  id: string;
  name: string;
  owner_id: string;
  active_member_count: number;
  vault_members: Array<{ user_id: string; status: string }>;
}

class FreeSyncSettingTab extends PluginSettingTab {
  // Tab-local JWT used only during the sign-in → vault-picker phase (before
  // the full plugin startSync() runs). Once a vault is picked and startSync
  // succeeds, plugin.currentJwt is the source of truth.
  private tempJwt: string | null = null;
  private tempUserEmail: string | null = null;

  constructor(app: App, private plugin: FreeSyncPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'FreeSync' });

    // State selection:
    //   C = connected (vaultId is set — either previously saved, or picked
    //       just now). currentJwt from plugin (if sync is running) enables
    //       the share section; otherwise the toggle brings sync online.
    //   B = signed in but no vault (tempJwt held from the picker sign-in)
    //   A = not signed in
    if (this.plugin.settings.vaultId) {
      this.renderConnected(containerEl);
    } else if (this.tempJwt) {
      void this.renderVaultPicker(containerEl);
    } else {
      this.renderSignIn(containerEl);
    }

    this.renderAdvanced(containerEl);
  }

  // ── State A: sign in ────────────────────────────────────────────────────
  private renderSignIn(el: HTMLElement) {
    el.createEl('h3', { text: 'Sign in to FreeSync' });

    let emailInput = '';
    let passwordInput = '';
    new Setting(el).setName('Email').addText(t => {
      t.inputEl.type = 'email';
      t.setValue(this.plugin.settings.email).onChange(v => { emailInput = v; });
      emailInput = t.getValue();
    });
    new Setting(el).setName('Password').addText(t => {
      t.inputEl.type = 'password';
      t.setValue(this.plugin.settings.password).onChange(v => { passwordInput = v; });
      passwordInput = t.getValue();
    });

    const errorRow = el.createDiv({ cls: 'freesync-settings-error' });
    errorRow.style.cssText = 'color:var(--text-error);margin:8px 0;min-height:1em;';

    new Setting(el).addButton(b => {
      b.setButtonText('Sign in').setCta();
      b.onClick(async () => {
        errorRow.textContent = '';
        b.setButtonText('Signing in…').setDisabled(true);
        const ok = await this.doSignIn(emailInput.trim(), passwordInput, errorRow);
        if (ok) this.display();  // re-render, will land in State B or C
        else b.setButtonText('Sign in').setDisabled(false);
      });
    });

    const webApp = this.plugin.settings.webAppUrl.replace(/\/+$/, '');
    const linkRow = el.createDiv();
    linkRow.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:8px;';
    linkRow.createSpan({ text: 'New here? ' });
    const link = linkRow.createEl('a', {
      text: `Create your account at ${webApp.replace(/^https?:\/\//, '')}`,
      href: `${webApp}/auth/signup`,
    });
    link.setAttr('target', '_blank');
  }

  // Sign-in helper shared by State A and used before showing picker.
  // Returns true on success (tempJwt populated, settings saved).
  private async doSignIn(email: string, password: string, errorEl: HTMLElement): Promise<boolean> {
    if (!email || !password) { errorEl.textContent = 'Enter email and password.'; return false; }
    try {
      const supabase = createClient(
        this.plugin.settings.supabaseUrl,
        this.plugin.settings.supabaseAnonKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        errorEl.textContent = error?.message ?? 'Sign in failed';
        return false;
      }
      this.tempJwt = data.session.access_token;
      this.tempUserEmail = email;
      this.plugin.settings.email = email;
      this.plugin.settings.password = password;
      await this.plugin.saveSettings();
      // If the Obsidian vault already has real content, assume the user
      // wants to sync it — either into their existing FreeSync vault of the
      // same name, or a fresh one we create for them. Falls through silently
      // to the normal vault picker if anything goes wrong.
      await this.trySmartVaultSelect();
      return true;
    } catch (e) {
      errorEl.textContent = `Sign in error: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  // Auto-select a FreeSync vault on sign-in when the Obsidian vault has
  // real files (i.e., isn't a fresh empty vault). Matches by name against
  // the user's existing active vaults first — this prevents accidental
  // duplicates when the user signs out and back in on the same vault.
  private async trySmartVaultSelect(): Promise<void> {
    const untitledRe = /^Untitled(\s+\d+)?$/i;
    const localFiles = this.plugin.app.vault.getFiles()
      .filter(f => !untitledRe.test(f.basename));
    if (localFiles.length === 0) return; // empty vault → user picks

    const vaultName = this.plugin.app.vault.getName();
    if (!vaultName) return;

    try {
      const listRes = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        headers: { Authorization: `Bearer ${this.tempJwt}` },
        throw: false,
      });
      if (listRes.status !== 200) return;
      const vaults = listRes.json as RemoteVaultSummary[];

      // Prefer an active vault with a matching name (avoid re-creating on
      // sign-out/sign-in cycles on the same Obsidian vault).
      const existing = vaults.find(v =>
        v.name.toLowerCase() === vaultName.toLowerCase() &&
        v.vault_members?.[0]?.status === 'active'
      );
      if (existing) {
        await this.attachToVault(existing.id, `Connected to existing vault "${existing.name}"`);
        return;
      }

      // No match — create a fresh vault named after the Obsidian vault.
      const createRes = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.tempJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: vaultName }),
        throw: false,
      });
      if (createRes.status !== 200 && createRes.status !== 201) return;
      await this.attachToVault(createRes.json.id, `Created FreeSync vault "${vaultName}"`);
    } catch { /* fall back to the picker silently */ }
  }

  private async attachToVault(vaultId: string, noticeText: string): Promise<void> {
    this.plugin.settings.vaultId = vaultId;
    this.plugin.settings.enabled = true;
    await this.plugin.saveSettings();
    try { await this.plugin.startSync(); } catch { /* Notice already shown */ }
    new Notice(`FreeSync: ${noticeText}`);
  }

  // ── State B: pick / create / join a vault ───────────────────────────────
  private async renderVaultPicker(el: HTMLElement) {
    const header = el.createDiv();
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
    header.createEl('span', { text: `Signed in as ${this.tempUserEmail ?? this.plugin.settings.email}` })
      .style.cssText = 'font-weight:600;';
    const signOutLink = header.createEl('a', { text: 'Sign out', href: '#' });
    signOutLink.style.cssText = 'font-size:12px;color:var(--text-muted);';
    signOutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.doSignOut();
    });

    const loading = el.createEl('p', { text: 'Loading your vaults…', cls: 'setting-item-description' });

    let vaults: RemoteVaultSummary[] = [];
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        headers: { Authorization: `Bearer ${this.tempJwt}` },
        throw: false,
      });
      if (res.status !== 200) {
        loading.textContent = `Couldn't load your vaults (${res.status}): ${res.json?.error ?? 'relay error'}`;
        return;
      }
      vaults = res.json as RemoteVaultSummary[];
    } catch (e) {
      loading.textContent = `Couldn't reach the relay: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    loading.remove();

    const activeVaults = vaults.filter(v => v.vault_members?.[0]?.status === 'active');
    const invitedVaults = vaults.filter(v => v.vault_members?.[0]?.status === 'invited');

    // ── Your vaults ──────────────────────────────────────────────────────
    if (activeVaults.length > 0) {
      el.createEl('h3', { text: 'Your vaults' });
      const list = el.createEl('div', { cls: 'freesync-vault-list' });
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:20px;';
      for (const v of activeVaults) {
        const row = list.createEl('button', { cls: 'freesync-vault-row' });
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px;cursor:pointer;text-align:left;';
        const nameEl = row.createEl('span', { text: v.name });
        nameEl.style.cssText = 'font-weight:500;';
        row.createEl('span', {
          text: `${v.active_member_count ?? 1} member${(v.active_member_count ?? 1) === 1 ? '' : 's'}`,
        }).style.cssText = 'font-size:12px;color:var(--text-muted);';
        row.addEventListener('click', () => void this.pickExistingVault(v.id));
      }
    }

    // ── Pending invitations (actionable) ─────────────────────────────────
    if (invitedVaults.length > 0) {
      el.createEl('h3', { text: 'Invitations' });
      const list = el.createDiv();
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:20px;';
      for (const v of invitedVaults) {
        const row = list.createDiv();
        row.style.cssText = [
          'display:flex', 'align-items:center', 'gap:10px',
          'padding:12px 14px',
          'background:var(--background-secondary)',
          'border-left:3px solid var(--interactive-accent)',
          'border-radius:6px',
        ].join(';');

        const info = row.createDiv();
        info.style.cssText = 'flex:1;min-width:0;';
        info.createEl('div', { text: v.name })
          .style.cssText = 'font-weight:600;font-size:14px;';
        info.createEl('div', { text: 'Someone shared this vault with you' })
          .style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px;';

        const acceptBtn = row.createEl('button', { text: 'Accept', cls: 'mod-cta' });
        acceptBtn.style.cssText = 'padding:6px 14px;';
        const declineBtn = row.createEl('button', { text: 'Decline' });
        declineBtn.style.cssText = 'padding:6px 12px;';

        acceptBtn.addEventListener('click', () => void this.acceptInvitation(v.id, acceptBtn, declineBtn));
        declineBtn.addEventListener('click', () => void this.declineInvitation(v.id, v.name, acceptBtn, declineBtn));
      }
    }

    // ── Create new ────────────────────────────────────────────────────────
    el.createEl('h3', { text: 'Create a new vault' });
    let newName = '';
    const createRow = el.createDiv();
    createRow.style.cssText = 'display:flex;gap:8px;margin-bottom:20px;';
    const nameInput = createRow.createEl('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Vault name';
    nameInput.style.cssText = 'flex:1;padding:6px 10px;';
    nameInput.addEventListener('input', () => { newName = nameInput.value.trim(); });
    const createBtn = createRow.createEl('button', { text: 'Create', cls: 'mod-cta' });
    createBtn.addEventListener('click', () => void this.createVault(newName, createBtn));
  }

  private async acceptInvitation(vaultId: string, acceptBtn: HTMLButtonElement, declineBtn: HTMLButtonElement) {
    acceptBtn.textContent = 'Accepting…';
    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults/${vaultId}/accept`,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.tempJwt}` },
        throw: false,
      });
      if (res.status !== 200) {
        new Notice(`Couldn't accept: ${res.json?.error ?? res.status}`);
        acceptBtn.textContent = 'Accept'; acceptBtn.disabled = false; declineBtn.disabled = false;
        return;
      }
      await this.pickExistingVault(vaultId);
    } catch (e) {
      new Notice(`Accept error: ${e instanceof Error ? e.message : String(e)}`);
      acceptBtn.textContent = 'Accept'; acceptBtn.disabled = false; declineBtn.disabled = false;
    }
  }

  private async declineInvitation(vaultId: string, vaultName: string, acceptBtn: HTMLButtonElement, declineBtn: HTMLButtonElement) {
    if (!window.confirm(`Decline invitation to "${vaultName}"?`)) return;
    declineBtn.textContent = 'Declining…';
    declineBtn.disabled = true;
    acceptBtn.disabled = true;
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults/${vaultId}/decline`,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.tempJwt}` },
        throw: false,
      });
      if (res.status !== 200) {
        new Notice(`Couldn't decline: ${res.json?.error ?? res.status}`);
        declineBtn.textContent = 'Decline'; declineBtn.disabled = false; acceptBtn.disabled = false;
        return;
      }
      this.display();  // re-render picker so the declined vault disappears
    } catch (e) {
      new Notice(`Decline error: ${e instanceof Error ? e.message : String(e)}`);
      declineBtn.textContent = 'Decline'; declineBtn.disabled = false; acceptBtn.disabled = false;
    }
  }

  private async pickExistingVault(vaultId: string) {
    this.plugin.settings.vaultId = vaultId;
    this.plugin.settings.enabled = true;
    await this.plugin.saveSettings();
    try { await this.plugin.startSync(); } catch (e) { new Notice(`Sync failed: ${e}`); }
    this.tempJwt = null;
    this.tempUserEmail = null;
    this.display();
  }

  private async createVault(name: string, btn: HTMLButtonElement) {
    if (!name) { new Notice('Enter a vault name'); return; }
    btn.textContent = 'Creating…';
    btn.disabled = true;
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.tempJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        throw: false,
      });
      if (res.status !== 201 && res.status !== 200) {
        new Notice(`Create failed: ${res.json?.error ?? res.status}`);
        btn.textContent = 'Create'; btn.disabled = false;
        return;
      }
      await this.pickExistingVault(res.json.id);
    } catch (e) {
      new Notice(`Create error: ${e instanceof Error ? e.message : String(e)}`);
      btn.textContent = 'Create'; btn.disabled = false;
    }
  }


  // ── State C: connected ──────────────────────────────────────────────────
  private renderConnected(el: HTMLElement) {
    const status = el.createDiv();
    status.style.cssText = 'padding:12px 14px;background:var(--background-secondary);border-radius:6px;margin-bottom:16px;';

    const statusLine = status.createEl('div');
    statusLine.style.cssText = 'font-weight:600;margin-bottom:2px;';
    const jwtOK = !!this.plugin.currentJwt;
    statusLine.textContent = jwtOK
      ? `✓ Connected as ${this.plugin.settings.email}`
      : `Configured — sync is paused`;

    const vaultLine = status.createEl('div');
    vaultLine.style.cssText = 'font-size:12px;color:var(--text-muted);';
    vaultLine.textContent = `Vault ID: ${this.plugin.settings.vaultId.slice(0, 8)}…`;
    // Fetch the real vault name if we have a live JWT
    if (jwtOK) void this.fillVaultName(vaultLine);

    const actionRow = status.createDiv();
    actionRow.style.cssText = 'display:flex;gap:12px;margin-top:8px;font-size:12px;';
    const signOutLink = actionRow.createEl('a', { text: 'Sign out', href: '#' });
    signOutLink.addEventListener('click', async (e) => { e.preventDefault(); await this.doSignOut(); });

    new Setting(el).setName('Enable sync').addToggle(t =>
      t.setValue(this.plugin.settings.enabled).onChange(async v => {
        this.plugin.settings.enabled = v;
        await this.plugin.saveSettings();
        if (v) await this.plugin.startSync();
        else await this.plugin.stopSync();
        this.display();
      }));

    // Share section — same Google-Docs-style UI as the ribbon share modal
    const shareArea = el.createDiv();
    shareArea.style.cssText = 'margin-top:18px;padding:16px 18px;background:var(--background-secondary);border-radius:8px;';
    renderShareUI(shareArea, this.plugin);
  }

  private async fillVaultName(vaultLine: HTMLElement) {
    try {
      const res = await requestUrl({
        url: `${this.plugin.getRelayHttpBase()}/vaults`,
        headers: { Authorization: `Bearer ${this.plugin.currentJwt}` },
        throw: false,
      });
      if (res.status !== 200) return;
      const vaults = res.json as RemoteVaultSummary[];
      const v = vaults.find(x => x.id === this.plugin.settings.vaultId);
      if (v) vaultLine.textContent = `${v.name} · ${v.active_member_count ?? 1} member${(v.active_member_count ?? 1) === 1 ? '' : 's'}`;
    } catch { /* silent — the ID stays displayed */ }
  }

  private async doSignOut() {
    await this.plugin.stopSync();
    this.plugin.settings.email = '';
    this.plugin.settings.password = '';
    this.plugin.settings.vaultId = '';
    this.plugin.settings.enabled = false;
    await this.plugin.saveSettings();
    this.tempJwt = null;
    this.tempUserEmail = null;
    this.display();
    new Notice('Signed out of FreeSync.');
  }

  // ── Advanced / self-hosting ─────────────────────────────────────────────
  private renderAdvanced(el: HTMLElement) {
    const details = el.createEl('details');
    details.style.cssText = 'margin-top:24px;padding:10px 14px;background:var(--background-secondary);border-radius:6px;';
    const summary = details.createEl('summary', { text: 'Advanced (self-hosting)' });
    summary.style.cssText = 'cursor:pointer;color:var(--text-muted);font-size:13px;';

    const note = details.createEl('p', {
      text: 'These defaults use FreeSync Cloud. Only change if you\'re running your own Supabase project and relay server.',
      cls: 'setting-item-description',
    });
    note.style.cssText = 'margin:8px 0 12px;';

    new Setting(details).setName('Supabase URL').addText(t =>
      t.setValue(this.plugin.settings.supabaseUrl)
        .onChange(async v => { this.plugin.settings.supabaseUrl = v; await this.plugin.saveSettings(); }));

    new Setting(details).setName('Supabase anon key').addText(t =>
      t.setValue(this.plugin.settings.supabaseAnonKey)
        .onChange(async v => { this.plugin.settings.supabaseAnonKey = v; await this.plugin.saveSettings(); }));

    new Setting(details).setName('Relay URL').addText(t =>
      t.setValue(this.plugin.settings.relayUrl)
        .onChange(async v => { this.plugin.settings.relayUrl = v; await this.plugin.saveSettings(); }));

    new Setting(details).setName('Web app URL')
      .setDesc('Used for sign-up and dashboard links.')
      .addText(t =>
        t.setValue(this.plugin.settings.webAppUrl)
          .onChange(async v => { this.plugin.settings.webAppUrl = v; await this.plugin.saveSettings(); }));

    new Setting(details).addButton(b => {
      b.setButtonText('Reset to FreeSync Cloud defaults').onClick(async () => {
        this.plugin.settings.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
        this.plugin.settings.supabaseAnonKey = DEFAULT_SETTINGS.supabaseAnonKey;
        this.plugin.settings.relayUrl = DEFAULT_SETTINGS.relayUrl;
        this.plugin.settings.webAppUrl = DEFAULT_SETTINGS.webAppUrl;
        await this.plugin.saveSettings();
        this.display();
      });
    });
  }

}

