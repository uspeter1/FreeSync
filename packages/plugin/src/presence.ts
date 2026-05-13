import { App } from 'obsidian';
import { Awareness } from 'y-protocols/awareness';

export interface UserPresence {
  id: string;
  display_name: string;
  color: string;
  initials: string;
  activeFile: string | null;
}

interface BadgeEntry {
  navItem: HTMLElement;
  inner: HTMLElement;
  badgeContainer: HTMLElement;
}

interface FileMetadata {
  lastEditedBy?: { userId: string; display_name: string; color: string };
  lastEditedAt?: number;
}

export class PresenceManager {
  private badgeData = new Map<string, BadgeEntry>();
  private awareness: Awareness | null = null;
  private localUserId: string | null = null;
  private fileMetadata = new Map<string, FileMetadata>();
  private activeFilePath: string | null = null;
  private statusBarEl: HTMLElement | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private app: App) {}

  setAwareness(awareness: Awareness, localUser: UserPresence) {
    this.awareness = awareness;
    this.localUserId = localUser.id;
    awareness.setLocalStateField('user', localUser);
    awareness.setLocalStateField('activeFile', null);
    awareness.on('change', () => this.renderBadges());
    this.refreshTimer = setInterval(() => this.updateStatusBar(), 60_000);
  }

  setStatusBar(el: HTMLElement, onClick: () => void) {
    this.statusBarEl = el;
    el.style.cursor = 'pointer';
    el.onclick = onClick;
    this.updateStatusBar();
  }

  setActiveFile(filePath: string | null) {
    this.activeFilePath = filePath;
    this.awareness?.setLocalStateField('activeFile', filePath);
    this.updateStatusBar();
  }

  setFileMetadata(filePath: string, data: FileMetadata) {
    this.fileMetadata.set(filePath, data);
    if (filePath === this.activeFilePath) this.updateStatusBar();
  }

  private relativeTime(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  private updateStatusBar() {
    if (!this.statusBarEl) return;
    const meta = this.activeFilePath ? this.fileMetadata.get(this.activeFilePath) : null;
    if (!meta?.lastEditedBy || !meta.lastEditedAt || meta.lastEditedBy.userId === this.localUserId) {
      this.statusBarEl.style.display = 'none';
      return;
    }
    this.statusBarEl.style.display = '';
    this.statusBarEl.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'freesync-statusbar-dot';
    dot.style.background = meta.lastEditedBy.color;
    this.statusBarEl.appendChild(dot);
    this.statusBarEl.appendChild(
      document.createTextNode(`${meta.lastEditedBy.display_name} · ${this.relativeTime(meta.lastEditedAt)}`)
    );
  }

  private renderBadges() {
    if (!this.awareness) return;

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

    this.clearBadges();

    for (const [filePath, users] of fileUsers) {
      this.renderFileBadge(filePath, users);
    }
  }

  private renderFileBadge(filePath: string, users: UserPresence[]) {
    const navItems = document.querySelectorAll('.nav-file-title');
    for (const rawNavItem of navItems) {
      const navItem = rawNavItem as HTMLElement;
      const titleEl = navItem.querySelector('.nav-file-title-content') as HTMLElement | null;
      const file = this.app.vault.getFileByPath(filePath);
      if (!file || !titleEl) continue;
      if (titleEl.textContent?.trim() !== file.basename) continue;

      const inner = navItem.querySelector('.tree-item-inner') as HTMLElement | null;
      if (!inner) continue;

      inner.style.display = 'flex';
      inner.style.alignItems = 'center';
      inner.style.flex = '1';
      inner.style.minWidth = '0';
      // Color bar — inset box-shadow, never border-left (breaks Obsidian indentation)
      inner.style.boxShadow = `inset 3px 0 0 ${users[0].color}`;

      const badgeContainer = document.createElement('span');
      badgeContainer.className = 'freesync-badges';
      badgeContainer.style.cssText = 'display:inline-flex;align-items:center;gap:3px;margin-left:auto;padding-left:8px;flex-shrink:0;';

      for (const user of users) {
        const avatar = document.createElement('span');
        avatar.className = 'freesync-badge';
        avatar.title = user.display_name;
        avatar.style.cssText = [
          'display:inline-block',
          'width:16px', 'height:16px', 'border-radius:50%',
          `background:${user.color}`, 'color:#fff',
          'font-size:9px', 'font-weight:700',
          'text-align:center', 'line-height:16px',
          'flex-shrink:0',
        ].join(';');
        avatar.textContent = user.display_name[0].toUpperCase();
        badgeContainer.appendChild(avatar);
      }

      inner.appendChild(badgeContainer);
      this.badgeData.set(filePath, { navItem, inner, badgeContainer });
      break;
    }
  }

  clearBadges() {
    for (const { inner, badgeContainer } of this.badgeData.values()) {
      inner.style.display = '';
      inner.style.alignItems = '';
      inner.style.flex = '';
      inner.style.minWidth = '';
      inner.style.boxShadow = '';
      badgeContainer.remove();
    }
    this.badgeData.clear();
  }

  destroy() {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.statusBarEl) { this.statusBarEl.style.display = 'none'; this.statusBarEl.onclick = null; }
    this.fileMetadata.clear();
    this.clearBadges();
    this.awareness = null;
  }
}
