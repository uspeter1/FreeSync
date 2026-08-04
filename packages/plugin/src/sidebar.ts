import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Awareness } from 'y-protocols/awareness';

export const VIEW_TYPE_FREESYNC = 'freesync-users';

interface UserState {
  display_name: string;
  color: string;
  initials: string;
  activeFile: string | null;
}

export class FreeSyncSidebarView extends ItemView {
  private awareness: Awareness | null = null;
  private localClientId = -1;
  private unsubscribe: (() => void) | null = null;

  getViewType() { return VIEW_TYPE_FREESYNC; }
  getDisplayText() { return 'FreeSync'; }
  getIcon() { return 'users'; }

  async onOpen() { this.render(); }
  async onClose() { this.detach(); }

  attach(awareness: Awareness, localClientId: number) {
    this.detach();
    this.awareness = awareness;
    this.localClientId = localClientId;
    const handler = () => this.render();
    awareness.on('change', handler);
    this.unsubscribe = () => awareness.off('change', handler);
    this.render();
  }

  detach() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.awareness = null;
    this.render();
  }

  private render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.style.cssText = 'padding:0;overflow-y:auto;';

    // Panel header — matches prototype purple pill
    const panel = root.createEl('div');
    panel.style.cssText = [
      'margin:12px 8px 8px',
      'padding:10px 12px',
      'background:#7c5cfc15',
      'border-radius:10px',
      'border:1px solid #7c5cfc25',
    ].join(';');

    const label = panel.createEl('div');
    label.style.cssText = 'color:#7c5cfc;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;';
    label.textContent = 'FreeSync Live';

    if (!this.awareness) {
      const msg = panel.createEl('div');
      msg.style.cssText = 'color:var(--text-muted);font-size:11px;';
      msg.textContent = 'Not connected';
      return;
    }

    const activeUsers: Array<UserState & { isLocal: boolean }> = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      const user = state?.user as UserState | undefined;
      if (!user?.display_name) continue;
      activeUsers.push({ ...user, isLocal: clientId === this.localClientId });
    }

    activeUsers.sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : 0));

    if (activeUsers.length === 0) {
      const msg = panel.createEl('div');
      msg.style.cssText = 'color:var(--text-muted);font-size:11px;';
      msg.textContent = 'No active users';
      return;
    }

    for (const user of activeUsers) {
      const row = panel.createEl('div');
      row.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:5px;';

      // Live dot
      const dot = row.createEl('div');
      dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${user.color};flex-shrink:0;`;

      // Name + optional file
      const info = row.createEl('div');
      info.style.cssText = 'min-width:0;flex:1;';

      const nameLine = info.createEl('div');
      nameLine.style.cssText = `color:${user.color};font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      nameLine.textContent = user.display_name.split(' ')[0] + (user.isLocal ? ' (you)' : '');

      if (user.activeFile) {
        const fileLine = info.createEl('div');
        fileLine.style.cssText = 'color:var(--text-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        fileLine.textContent = user.activeFile.replace(/\.md$/, '');
      }
    }
  }
}
