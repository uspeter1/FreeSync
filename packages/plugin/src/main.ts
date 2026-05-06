import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncManager } from './sync';
import { PresenceManager } from './presence';

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
  private syncManager!: SyncManager;
  private presenceManager!: PresenceManager;

  async onload() {
    await this.loadSettings();

    this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.presenceManager = new PresenceManager(this.app);
    this.syncManager = new SyncManager(this.app, this.presenceManager);

    this.addSettingTab(new FreeSyncSettingTab(this.app, this));

    if (this.settings.enabled && this.settings.email && this.settings.vaultId) {
      await this.startSync();
    }
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
      });

      new Notice('FreeSync: Connected');
    } catch (err) {
      new Notice(`FreeSync: Error — ${err}`);
      console.error('FreeSync startSync error:', err);
    }
  }

  async stopSync() {
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
