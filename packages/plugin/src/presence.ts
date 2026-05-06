import { App } from 'obsidian';
import { Awareness } from 'y-protocols/awareness';

export interface UserPresence {
  id: string;
  display_name: string;
  color: string;
  initials: string;
  activeFile: string | null;
}

export class PresenceManager {
  private badges = new Map<string, HTMLElement>();
  private awareness: Awareness | null = null;

  constructor(private app: App) {}

  setAwareness(awareness: Awareness, localUser: UserPresence) {
    this.awareness = awareness;
    awareness.setLocalStateField('user', localUser);
    awareness.setLocalStateField('activeFile', null);

    awareness.on('change', () => this.renderBadges());
  }

  setActiveFile(filePath: string | null) {
    this.awareness?.setLocalStateField('activeFile', filePath);
  }

  private renderBadges() {
    if (!this.awareness) return;

    // Gather all remote users and which file they have open
    const fileUsers = new Map<string, UserPresence[]>();
    const localId = this.awareness.clientID;

    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === localId || !state?.user) continue;
      const user = state.user as UserPresence;
      const file = (state.activeFile as string | null) ?? null;
      if (file) {
        if (!fileUsers.has(file)) fileUsers.set(file, []);
        fileUsers.get(file)!.push(user);
      }
    }

    // Clear all existing badges
    this.clearBadges();

    // Render new badges
    for (const [filePath, users] of fileUsers) {
      this.renderFileBadge(filePath, users);
    }
  }

  private renderFileBadge(filePath: string, users: UserPresence[]) {
    // Find the nav item for this file in Obsidian's file explorer
    const navItems = document.querySelectorAll('.nav-file-title');
    for (const navItem of navItems) {
      const titleEl = navItem.querySelector('.nav-file-title-content');
      const file = this.app.vault.getFileByPath(filePath);
      if (!file || !titleEl) continue;
      if (titleEl.textContent?.trim() !== file.basename) continue;

      const inner = navItem.querySelector('.tree-item-inner') as HTMLElement | null;
      if (!inner) continue;

      // Color bar via inset box-shadow (never border-left — breaks indentation)
      inner.style.boxShadow = `inset 3px 0 0 ${users[0].color}`;

      // Avatar badges
      const badgeContainer = document.createElement('span');
      badgeContainer.className = 'freesync-badges';
      badgeContainer.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0;';

      for (const user of users.slice(0, 3)) {
        const avatar = document.createElement('span');
        avatar.className = 'freesync-badge';
        avatar.title = user.display_name;
        avatar.style.cssText = `
          display:inline-flex;align-items:center;justify-content:center;
          width:20px;height:20px;border-radius:50%;
          background:${user.color};color:#fff;
          font-size:9px;font-weight:700;
          border:1.5px solid rgba(255,255,255,0.2);
          flex-shrink:0;
        `;
        avatar.textContent = user.initials;
        badgeContainer.appendChild(avatar);
      }

      inner.appendChild(badgeContainer);
      this.badges.set(filePath, badgeContainer);
      break;
    }
  }

  clearBadges() {
    for (const badge of this.badges.values()) {
      // Remove inset shadow from parent inner
      const inner = badge.parentElement as HTMLElement | null;
      if (inner) inner.style.boxShadow = '';
      badge.remove();
    }
    this.badges.clear();
  }

  destroy() {
    this.clearBadges();
    this.awareness = null;
  }
}
