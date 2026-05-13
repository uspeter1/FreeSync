import { Extension, StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import * as Y from 'yjs';

export interface CommentsRef {
  getComments: ((filePath: string) => Y.Map<Y.Map<any>> | null) | null;
  localUser: { id: string; display_name: string; color: string } | null;
  focusComment: ((commentId: string) => void) | null;
  focusedCommentId: string | null;
  requestRedecorations: Array<() => void>;
  // Position tracking — written by CM6, read by panel
  commentPositions: Map<string, number>;  // id (or 'draft') → doc-relative y
  draftCharOffset: number | null;         // set by panel; CM6 computes y and stores as 'draft'
  editorMetrics: { scrollTop: number; viewportTop: number; scrollHeight: number } | null;
  onPositionsUpdate: (() => void) | null;
}

export interface ReplyData {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
}

const commentsRefresh = StateEffect.define<void>();

function getFilePath(view: EditorView): string | undefined {
  const info = view.state.field(editorInfoField, false);
  return (info as any)?.file?.path as string | undefined;
}

// Renders yellow highlight decorations for each active (non-resolved) comment range
function commentsHighlightPlugin(ref: CommentsRef): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    private yComments: Y.Map<Y.Map<any>> | null = null;
    private currentFilePath: string | undefined;
    private commentsCleaner: (() => void) | null = null;
    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private lastFocusedId: string | null = null;
    private redecorate: () => void;
    private scrollListener: () => void;
    private editorView: EditorView;
    // Cached viewport-top of the editor scroll container.
    // Only written outside CM6's update cycle (constructor + scroll listener)
    // to avoid forced synchronous reflows during CM6 transaction processing.
    private cachedViewportTop = 0;

    constructor(view: EditorView) {
      this.editorView = view;
      this.currentFilePath = getFilePath(view);
      // Safe to call getBoundingClientRect here — we're not inside an update cycle yet
      this.cachedViewportTop = view.scrollDOM.getBoundingClientRect().top;
      this.redecorate = () => {
        // Called from panel code (outside CM6 update cycle) — safe to call trySubscribe here
        if (!this.commentsCleaner) this.trySubscribe(view);
        view.dispatch({ effects: commentsRefresh.of() });
      };
      ref.requestRedecorations.push(this.redecorate);
      this.scrollListener = () => {
        // Scroll listener fires outside CM6's update cycle — safe to read layout
        this.cachedViewportTop = view.scrollDOM.getBoundingClientRect().top;
        this.computePositions(view);
        ref.onPositionsUpdate?.();
      };
      view.scrollDOM.addEventListener('scroll', this.scrollListener, { passive: true });
      this.trySubscribe(view);
    }

    private trySubscribe(view: EditorView) {
      if (this.commentsCleaner) return;
      if (!ref.getComments || !this.currentFilePath) {
        this.startPoll(view);
        return;
      }
      const yc = ref.getComments(this.currentFilePath);
      if (!yc) { this.startPoll(view); return; }

      if (this.pollInterval !== null) { clearInterval(this.pollInterval); this.pollInterval = null; }
      this.yComments = yc;
      const handler = () => view.dispatch({ effects: commentsRefresh.of() });
      yc.observeDeep(handler);
      this.commentsCleaner = () => yc.unobserveDeep(handler);
      view.dispatch({ effects: commentsRefresh.of() });
    }

    private startPoll(view: EditorView) {
      if (this.pollInterval !== null) return;
      this.pollInterval = setInterval(() => this.trySubscribe(view), 500);
    }

    private resubscribeIfFileChanged(view: EditorView) {
      const fp = getFilePath(view);
      if (fp === this.currentFilePath) return;
      if (this.pollInterval !== null) { clearInterval(this.pollInterval); this.pollInterval = null; }
      this.commentsCleaner?.();
      this.commentsCleaner = null;
      this.yComments = null;
      this.currentFilePath = fp;
      this.trySubscribe(view);
    }

    private computePositions(view: EditorView) {
      if (!this.yComments) return;
      ref.commentPositions.clear();
      // Use the cached viewportTop — never call getBoundingClientRect() here because
      // this method is also called from update(), which runs inside CM6's transaction
      // processing. A forced reflow there breaks CM6's rendering pipeline.
      ref.editorMetrics = {
        scrollTop: view.scrollDOM.scrollTop,
        viewportTop: this.cachedViewportTop,
        scrollHeight: view.scrollDOM.scrollHeight,
      };
      const docLen = view.state.doc.length;
      this.yComments.forEach((comment) => {
        if (comment.get('resolved')) return;
        const id = comment.get('id') as string;
        const from = comment.get('from') as number;
        if (!id || typeof from !== 'number') return;
        try {
          const safePos = Math.max(0, Math.min(Math.round(from), docLen));
          ref.commentPositions.set(id, view.lineBlockAt(safePos).top);
        } catch { /* pos might be in a folded region */ }
      });
      if (ref.draftCharOffset !== null) {
        try {
          const safePos = Math.max(0, Math.min(ref.draftCharOffset, docLen));
          ref.commentPositions.set('draft', view.lineBlockAt(safePos).top);
        } catch {}
      }
    }

    update(update: ViewUpdate) {
      this.resubscribeIfFileChanged(update.view);
      const focusChanged = ref.focusedCommentId !== this.lastFocusedId;
      if (focusChanged) this.lastFocusedId = ref.focusedCommentId;
      const needsUpdate = focusChanged || update.docChanged || update.viewportChanged ||
        update.transactions.some(tr => tr.effects.some(e => e.is(commentsRefresh)));
      if (needsUpdate) {
        this.computePositions(update.view);
        this.decorations = this.build(update.view);
        ref.onPositionsUpdate?.();
      }
    }

    destroy() {
      const idx = ref.requestRedecorations.indexOf(this.redecorate);
      if (idx !== -1) ref.requestRedecorations.splice(idx, 1);
      this.editorView.scrollDOM.removeEventListener('scroll', this.scrollListener);
      if (this.pollInterval !== null) { clearInterval(this.pollInterval); this.pollInterval = null; }
      this.commentsCleaner?.();
    }

    build(view: EditorView): DecorationSet {
      if (!this.yComments) return Decoration.none;
      const docLen = view.state.doc.length;

      type MarkRange = { from: number; to: number; id: string };
      const pending: MarkRange[] = [];

      try {
        this.yComments.forEach((comment) => {
          if (comment.get('resolved')) return;
          const from = comment.get('from') as number;
          const to = comment.get('to') as number;
          const id = comment.get('id') as string;
          if (typeof from !== 'number' || typeof to !== 'number' || !id) return;
          const f = Math.min(Math.max(Math.round(from), 0), docLen);
          const t = Math.min(Math.max(Math.round(to), 0), docLen);
          if (f >= t) return;
          pending.push({ from: f, to: t, id });
        });
      } catch { return Decoration.none; }

      if (pending.length === 0) return Decoration.none;
      pending.sort((a, b) => a.from - b.from || a.to - b.to);

      // Remove partial overlaps (keep nested ones — CM6 allows containment, not cross-overlap)
      const safe: MarkRange[] = [];
      for (const mr of pending) {
        let conflict = false;
        for (const ex of safe) {
          const partialOverlap =
            mr.from < ex.to && mr.to > ex.from &&
            !(mr.from >= ex.from && mr.to <= ex.to) &&
            !(ex.from >= mr.from && ex.to <= mr.to);
          if (partialOverlap) { conflict = true; break; }
        }
        if (!conflict) safe.push(mr);
      }

      const focusedId = ref.focusedCommentId;
      const ranges = safe.map(mr =>
        Decoration.mark({
          class: mr.id === focusedId
            ? 'freesync-comment-range freesync-comment-range--focused'
            : 'freesync-comment-range',
          attributes: { 'data-comment-id': mr.id },
        }).range(mr.from, mr.to)
      );

      try {
        return Decoration.set(ranges, true);
      } catch { return Decoration.none; }
    }
  }, {
    decorations: v => v.decorations,
    eventHandlers: {
      mousedown(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const el = target.closest('[data-comment-id]') as HTMLElement | null;
        if (!el) return;
        const id = el.dataset.commentId;
        if (id) ref.focusComment?.(id);
      }
    }
  });
}

export function commentsExtension(ref: CommentsRef): Extension {
  return commentsHighlightPlugin(ref);
}
