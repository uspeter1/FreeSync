import { ItemView, WorkspaceLeaf } from 'obsidian';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { CommentsRef, ReplyData } from './comments';

export const VIEW_TYPE_COMMENTS = 'freesync-comments';

interface LocalUser {
  id: string;
  display_name: string;
  color: string;
}

interface CommentEntry {
  id: string;
  from: number;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
  replies: ReplyData[];
}

export class CommentsPanelView extends ItemView {
  private yComments: Y.Map<Y.Map<any>> | null = null;
  private focusedCommentId: string | null = null;
  private unsub: (() => void) | null = null;
  private localUser: LocalUser | null = null;
  private awareness: Awareness | null = null;
  private draft: { from: number; to: number } | null = null;
  private mentionDropdown: HTMLElement | null = null;
  private commentsRef: CommentsRef | null = null;
  private repositionFrame: number | null = null;

  getViewType() { return VIEW_TYPE_COMMENTS; }
  getDisplayText() { return 'Comments'; }
  getIcon() { return 'message-square'; }

  async onOpen() { this.render(); }
  async onClose() { this.hideMentionDropdown(); this.detach(); }

  attach(yComments: Y.Map<Y.Map<any>>, localUser: LocalUser, awareness: Awareness, commentsRef?: CommentsRef) {
    this.detach();
    this.yComments = yComments;
    this.localUser = localUser;
    this.awareness = awareness;
    this.commentsRef = commentsRef ?? null;
    if (commentsRef) {
      commentsRef.onPositionsUpdate = () => this.repositionCards();
      commentsRef.commentPositions.clear();
      commentsRef.editorMetrics = null;
      // Trigger CM6 to compute initial positions
      for (const cb of commentsRef.requestRedecorations) cb();
    }
    const handler = () => this.render();
    yComments.observeDeep(handler);
    this.unsub = () => yComments.unobserveDeep(handler);
    this.render();
  }

  startDraft(from: number, to: number) {
    this.draft = { from, to };
    if (this.commentsRef) {
      this.commentsRef.draftCharOffset = from;
      for (const cb of this.commentsRef.requestRedecorations) cb();
    }
    this.render();
    setTimeout(() => {
      const ta = this.containerEl.querySelector('.freesync-draft-card textarea') as HTMLTextAreaElement | null;
      ta?.focus();
    }, 50);
  }

  focus(commentId: string) {
    this.focusedCommentId = commentId;
    if (this.commentsRef) {
      this.commentsRef.focusedCommentId = commentId;
      for (const cb of this.commentsRef.requestRedecorations) cb();
    }
    this.render();
    // After render, cards are repositioned — the focused card will be at its natural position
  }

  detach() {
    this.unsub?.();
    this.unsub = null;
    this.yComments = null;
    this.awareness = null;
    this.draft = null;
    this.focusedCommentId = null;
    if (this.commentsRef) {
      this.commentsRef.focusedCommentId = null;
      this.commentsRef.onPositionsUpdate = null;
      this.commentsRef.draftCharOffset = null;
      this.commentsRef.commentPositions.clear();
      for (const cb of this.commentsRef.requestRedecorations) cb();
      this.commentsRef = null;
    }
    if (this.repositionFrame !== null) {
      cancelAnimationFrame(this.repositionFrame);
      this.repositionFrame = null;
    }
    this.hideMentionDropdown();
    this.render();
  }

  private render() {
    // Keep draftCharOffset in sync with current draft state
    if (this.commentsRef) {
      this.commentsRef.draftCharOffset = this.draft?.from ?? null;
    }

    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.className = 'freesync-comments-panel';

    root.createEl('div', { cls: 'freesync-comments-header', text: 'Comments' });

    if (!this.yComments) {
      root.createEl('div', { cls: 'freesync-comments-empty', text: 'Open a file to see comments.' });
      return;
    }

    const comments: CommentEntry[] = [];
    try {
      this.yComments.forEach((comment) => {
        if (comment.get('resolved')) return;
        const id = comment.get('id') as string;
        if (!id) return;
        comments.push({
          id,
          from: (comment.get('from') as number) ?? 0,
          authorName: (comment.get('authorName') as string) ?? 'Unknown',
          authorColor: (comment.get('authorColor') as string) ?? '#7c5cfc',
          text: (comment.get('text') as string) ?? '',
          createdAt: (comment.get('createdAt') as number) ?? 0,
          replies: (comment.get('replies') as Y.Array<ReplyData> | undefined)?.toArray() ?? [],
        });
      });
    } catch { /* transitioning */ }

    comments.sort((a, b) => a.from - b.from);

    if (comments.length === 0 && !this.draft) {
      root.createEl('div', {
        cls: 'freesync-comments-empty',
        text: 'No comments yet. Select text and right-click to add one.',
      });
      return;
    }

    const cardsContainer = root.createEl('div', { cls: 'freesync-cards-container' });

    // Interleave draft card at the correct document position
    let draftInserted = false;
    for (const comment of comments) {
      if (!draftInserted && this.draft && this.draft.from <= comment.from) {
        this.renderDraftCard(cardsContainer);
        draftInserted = true;
      }
      this.renderCard(cardsContainer, comment);
    }
    if (!draftInserted && this.draft) this.renderDraftCard(cardsContainer);

    // Schedule positioning after layout is painted
    if (this.repositionFrame !== null) cancelAnimationFrame(this.repositionFrame);
    this.repositionFrame = requestAnimationFrame(() => {
      this.repositionFrame = null;
      this.positionCards();
    });
  }

  // ── Draft card (before Yjs commit) ────────────────────────────────────────

  private renderDraftCard(root: HTMLElement) {
    const card = root.createEl('div', { cls: 'freesync-comment-card focused freesync-draft-card' });
    card.setAttribute('data-comment-card', 'draft');

    if (this.localUser) {
      const headerRow = card.createEl('div', { cls: 'freesync-comment-card-header' });
      const initials = this.localUser.display_name.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U';
      const avatar = headerRow.createEl('div', { cls: 'freesync-comment-avatar', text: initials });
      avatar.style.background = this.localUser.color;
      const meta = headerRow.createEl('div', { cls: 'freesync-comment-meta' });
      meta.createEl('div', { cls: 'freesync-comment-author', text: this.localUser.display_name }).style.color = this.localUser.color;
    }

    const section = card.createEl('div', { cls: 'freesync-comment-reply-section' });
    const textarea = section.createEl('textarea', {
      cls: 'freesync-comment-reply-input',
      attr: { placeholder: 'Add a comment… (type @ to mention someone)' },
    }) as HTMLTextAreaElement;
    textarea.addEventListener('click', (e) => e.stopPropagation());
    this.attachMentionSupport(textarea);

    const actionsRow = section.createEl('div', { cls: 'freesync-comment-actions' });

    const cancelBtn = actionsRow.createEl('button', { cls: 'freesync-resolve-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.draft = null;
      this.hideMentionDropdown();
      this.render();
    });

    const submit = () => {
      const text = textarea.value.trim();
      if (!text || !this.yComments || !this.localUser || !this.draft) return;
      const id = crypto.randomUUID();
      const { from, to } = this.draft;
      this.yComments.doc!.transact(() => {
        const comment = new Y.Map();
        const replies = new Y.Array();
        comment.set('id', id);
        comment.set('authorId', this.localUser!.id);
        comment.set('authorName', this.localUser!.display_name);
        comment.set('authorColor', this.localUser!.color);
        comment.set('text', text);
        comment.set('from', from);
        comment.set('to', to);
        comment.set('createdAt', Date.now());
        comment.set('resolved', false);
        comment.set('replies', replies);
        this.yComments!.set(id, comment);
      }, 'local');
      this.draft = null;
      this.hideMentionDropdown();
      this.focus(id);
    };

    actionsRow.createEl('button', { cls: 'freesync-reply-btn', text: 'Comment' })
      .addEventListener('click', (e) => { e.stopPropagation(); submit(); });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hideMentionDropdown(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
  }

  // ── Existing comment card ─────────────────────────────────────────────────

  private renderCard(root: HTMLElement, comment: CommentEntry) {
    const focused = comment.id === this.focusedCommentId;
    const card = root.createEl('div', { cls: `freesync-comment-card${focused ? ' focused' : ''}` });
    card.setAttribute('data-comment-card', comment.id);
    card.addEventListener('click', () => this.focus(comment.id));

    const headerRow = card.createEl('div', { cls: 'freesync-comment-card-header' });
    const initials = comment.authorName.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U';
    const avatar = headerRow.createEl('div', { cls: 'freesync-comment-avatar', text: initials });
    avatar.style.background = comment.authorColor;
    const meta = headerRow.createEl('div', { cls: 'freesync-comment-meta' });
    meta.createEl('div', { cls: 'freesync-comment-author', text: comment.authorName }).style.color = comment.authorColor;
    meta.createEl('div', { cls: 'freesync-comment-timestamp', text: this.formatTimestamp(comment.createdAt) });

    this.renderCommentText(card, comment.text, 'freesync-comment-text');

    if (comment.replies.length > 0) {
      const repliesEl = card.createEl('div', { cls: 'freesync-comment-replies' });
      for (const reply of comment.replies) this.renderReply(repliesEl, reply);
    }

    if (focused) {
      const section = card.createEl('div', { cls: 'freesync-comment-reply-section' });
      const replyInput = section.createEl('textarea', {
        cls: 'freesync-comment-reply-input',
        attr: { placeholder: 'Reply… (type @ to mention someone)' },
      }) as HTMLTextAreaElement;
      replyInput.addEventListener('click', (e) => e.stopPropagation());
      this.attachMentionSupport(replyInput);

      const actionsRow = section.createEl('div', { cls: 'freesync-comment-actions' });

      const resolveBtn = actionsRow.createEl('button', { cls: 'freesync-resolve-btn', text: '✓ Resolve' });
      resolveBtn.addEventListener('click', (e) => { e.stopPropagation(); this.resolveComment(comment.id); });

      const submitReply = () => {
        const text = replyInput.value.trim();
        if (text) { this.addReply(comment.id, text); replyInput.value = ''; }
      };

      actionsRow.createEl('button', { cls: 'freesync-reply-btn', text: 'Reply' })
        .addEventListener('click', (e) => { e.stopPropagation(); submitReply(); });

      replyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); this.hideMentionDropdown(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitReply(); }
      });
    }
  }

  private renderReply(container: HTMLElement, reply: ReplyData) {
    const row = container.createEl('div', { cls: 'freesync-reply' });
    const headerRow = row.createEl('div', { cls: 'freesync-reply-header' });
    const initials = reply.authorName.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U';
    const avatar = headerRow.createEl('div', { cls: 'freesync-reply-avatar', text: initials });
    avatar.style.background = reply.authorColor;
    const meta = headerRow.createEl('div', { cls: 'freesync-reply-meta' });
    const name = meta.createEl('span', { cls: 'freesync-reply-author', text: reply.authorName });
    name.style.color = reply.authorColor;
    meta.createEl('span', { cls: 'freesync-reply-timestamp', text: ` · ${this.formatTimestamp(reply.createdAt)}` });
    this.renderCommentText(row, reply.text, 'freesync-reply-text');
  }

  // ── Card positioning (Google Docs-style vertical alignment) ───────────────

  private positionCards() {
    const ref = this.commentsRef;
    if (!ref?.editorMetrics) return;

    const root = this.containerEl.children[1] as HTMLElement;
    const container = root.querySelector<HTMLElement>('.freesync-cards-container');
    if (!container) return;

    const { commentPositions, editorMetrics } = ref;
    const { scrollTop: editorScrollTop, viewportTop: editorViewportTop, scrollHeight: editorScrollHeight } = editorMetrics;

    // Make the container the same scroll-height as the editor so linked scrolling works end-to-end
    container.style.minHeight = `${editorScrollHeight}px`;

    // Compute how much vertical offset exists between the editor scroll origin and the panel scroll origin.
    // panelScrollTop = editorScrollTop + verticalOffset keeps cards visually aligned with their highlights.
    // container.offsetTop accounts for the "Comments" header above the cards.
    const verticalOffset = root.getBoundingClientRect().top + container.offsetTop - editorViewportTop;
    const targetScrollTop = Math.max(0, editorScrollTop + verticalOffset);

    // Suppress the scroll listener on root while we set scrollTop programmatically
    root.scrollTop = targetScrollTop;

    // Build list of (element, docY) pairs sorted by docY
    type Entry = { el: HTMLElement; docY: number };
    const entries: Entry[] = [];
    container.querySelectorAll<HTMLElement>('[data-comment-card]').forEach(el => {
      const id = el.dataset.commentCard!;
      const docY = commentPositions.get(id);
      if (docY !== undefined) entries.push({ el, docY });
    });
    entries.sort((a, b) => a.docY - b.docY);

    // Collapsed half-height: used as the centering anchor for focused/expanded cards so
    // the card grows downward while keeping the same vertical alignment point.
    // Measure from the first unfocused card in the list; fall back to a constant.
    let collapsedHalfH = 36;
    for (const { el } of entries) {
      if (!el.classList.contains('focused')) { collapsedHalfH = el.offsetHeight / 2; break; }
    }

    // Apply positions with push-down to avoid overlap
    let minTop = 8;
    for (const { el, docY } of entries) {
      const halfH = el.classList.contains('focused') ? collapsedHalfH : el.offsetHeight / 2;
      const top = Math.max(docY - halfH, minTop);
      el.style.position = 'absolute';
      el.style.margin = '0';
      el.style.left = '8px';
      el.style.right = '8px';
      el.style.top = `${top}px`;
      minTop = top + el.offsetHeight + 8;
    }

    // Expand container to fit the lowest card
    if (entries.length > 0) {
      const last = entries[entries.length - 1];
      const lastTop = parseFloat(last.el.style.top) || 0;
      const needed = lastTop + last.el.offsetHeight + 16;
      if (needed > editorScrollHeight) container.style.minHeight = `${needed}px`;
    }
  }

  private repositionCards() {
    if (this.repositionFrame !== null) return;
    this.repositionFrame = requestAnimationFrame(() => {
      this.repositionFrame = null;
      this.positionCards();
    });
  }

  // ── Render comment / reply text with @ mention highlighting ──────────────

  private renderCommentText(container: HTMLElement, text: string, cls: string) {
    const el = container.createEl('div', { cls });
    const knownNames = this.getMentionableUsers()
      .map(u => u.display_name)
      .sort((a, b) => b.length - a.length); // longest first to avoid prefix collisions

    let remaining = text;
    while (remaining.length > 0) {
      const atIdx = remaining.indexOf('@');
      if (atIdx === -1) { el.appendText(remaining); break; }
      if (atIdx > 0) el.appendText(remaining.slice(0, atIdx));
      remaining = remaining.slice(atIdx + 1); // consume '@'

      let matched = false;
      for (const name of knownNames) {
        if (remaining.toLowerCase().startsWith(name.toLowerCase())) {
          el.createEl('span', { cls: 'freesync-mention-text', text: `@${remaining.slice(0, name.length)}` });
          remaining = remaining.slice(name.length);
          matched = true;
          break;
        }
      }
      if (!matched) el.appendText('@');
    }
  }

  // ── @ mention support ─────────────────────────────────────────────────────

  private attachMentionSupport(textarea: HTMLTextAreaElement) {
    textarea.addEventListener('input', () => {
      const cursor = textarea.selectionStart ?? 0;
      const before = textarea.value.substring(0, cursor);
      const match = before.match(/@(\w*)$/);
      if (match) {
        this.showMentionDropdown(textarea, match[1]);
      } else {
        this.hideMentionDropdown();
      }
    });
    // Delay so a mousedown on a dropdown item fires before blur hides it
    textarea.addEventListener('blur', () => setTimeout(() => this.hideMentionDropdown(), 150));
  }

  private showMentionDropdown(textarea: HTMLTextAreaElement, query: string) {
    this.hideMentionDropdown();

    const allUsers = this.getMentionableUsers();
    const matches = query
      ? allUsers.filter(u => u.display_name.toLowerCase().startsWith(query.toLowerCase()))
      : allUsers;
    if (matches.length === 0) return;

    const rect = textarea.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'freesync-mention-dropdown';
    dropdown.style.cssText = [
      'position:fixed',
      `top:${rect.bottom + 2}px`,
      `left:${rect.left}px`,
      `min-width:${Math.max(rect.width, 160)}px`,
      'z-index:9999',
    ].join(';');

    for (const user of matches) {
      const item = document.createElement('div');
      item.className = 'freesync-mention-item';

      const initials = user.display_name.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || 'U';
      const avatar = document.createElement('div');
      avatar.className = 'freesync-mention-avatar';
      avatar.textContent = initials;
      avatar.style.background = user.color;

      const name = document.createElement('span');
      name.textContent = user.display_name;

      item.appendChild(avatar);
      item.appendChild(name);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep textarea focused
        this.insertMention(textarea, query, user.display_name);
        this.hideMentionDropdown();
        textarea.focus();
      });
      dropdown.appendChild(item);
    }

    document.body.appendChild(dropdown);
    this.mentionDropdown = dropdown;
  }

  private hideMentionDropdown() {
    this.mentionDropdown?.remove();
    this.mentionDropdown = null;
  }

  private getMentionableUsers(): Array<{ display_name: string; color: string }> {
    if (!this.awareness) return [];
    const seen = new Set<string>();
    const users: Array<{ display_name: string; color: string }> = [];
    for (const [, state] of this.awareness.getStates()) {
      const u = state?.user as { display_name: string; color: string } | undefined;
      if (u?.display_name && !seen.has(u.display_name)) {
        seen.add(u.display_name);
        users.push({ display_name: u.display_name, color: u.color });
      }
    }
    return users;
  }

  private insertMention(textarea: HTMLTextAreaElement, query: string, displayName: string) {
    const cursor = textarea.selectionStart ?? 0;
    const before = textarea.value.substring(0, cursor - query.length - 1); // strip @query
    const after = textarea.value.substring(cursor);
    const insert = `@${displayName} `;
    textarea.value = before + insert + after;
    const pos = before.length + insert.length;
    textarea.setSelectionRange(pos, pos);
    textarea.dispatchEvent(new Event('input')); // re-evaluate pattern
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private formatTimestamp(ts: number): string {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString())
      return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (date.getFullYear() === now.getFullYear())
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private addReply(commentId: string, text: string) {
    if (!this.yComments || !this.localUser) return;
    const replies = this.yComments.get(commentId)?.get('replies') as Y.Array<ReplyData> | undefined;
    if (!replies) return;
    replies.push([{
      id: crypto.randomUUID(),
      authorId: this.localUser.id,
      authorName: this.localUser.display_name,
      authorColor: this.localUser.color,
      text,
      createdAt: Date.now(),
    }]);
  }

  private resolveComment(commentId: string) {
    if (!this.yComments) return;
    this.yComments.get(commentId)?.set('resolved', true);
    if (this.focusedCommentId === commentId) this.focusedCommentId = null;
  }
}
