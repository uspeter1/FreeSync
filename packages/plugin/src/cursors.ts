import { Extension, StateEffect, Range } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { Awareness } from 'y-protocols/awareness';
import { editorInfoField } from 'obsidian';

export interface AwarenessRef {
  awareness: Awareness | null;
  localClientId: number;
  // Supabase user.id of the signed-in account. When the same user is
  // connected from multiple devices, cursors from those other devices
  // render with the label "You" instead of the display name.
  localUserId: string | null;
}

export interface RemoteCursorPos {
  head: number;
  anchor: number;
  updatedAt: number; // Date.now() when last moved; 0 = not typing
}

// Dispatched to force a decoration rebuild when awareness changes externally
const cursorRefresh = StateEffect.define<void>();

class CursorWidget extends WidgetType {
  constructor(
    private displayName: string,
    private color: string,
    private isTyping: boolean,
  ) { super(); }

  eq(other: CursorWidget) {
    return other.displayName === this.displayName
      && other.color === this.color
      && other.isTyping === this.isTyping;
  }

  toDOM(): HTMLElement {
    // Zero-width anchor so we don't shift text
    const wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative;display:inline;width:0;overflow:visible;';

    // Wide transparent hit area — 12px centred on cursor so proximity hovering is easy
    const hit = document.createElement('span');
    hit.style.cssText = [
      'position:absolute',
      'top:0', 'bottom:0',
      'left:-6px', 'width:12px',
      'pointer-events:all',
      'cursor:default',
    ].join(';');

    // Visual cursor line — 2px, centred in hit area
    const line = document.createElement('span');
    line.style.cssText = [
      'position:absolute',
      'top:0', 'bottom:0',
      'left:5px', 'width:2px',
      `background:${this.color}`,
      'pointer-events:none',
    ].join(';');

    // Flag head — small tab at top of line, always visible, gives a clear hover target
    const flag = document.createElement('span');
    flag.style.cssText = [
      'position:absolute',
      'top:-1px',
      'left:5px',           // flush with left edge of cursor line
      'height:7px',
      'min-width:7px',
      `background:${this.color}`,
      'border-radius:2px 2px 2px 0',
      'pointer-events:none',
    ].join(';');

    // Name label — shown on hover or while typing
    const label = document.createElement('span');
    label.textContent = this.displayName;
    label.style.cssText = [
      'position:absolute',
      'top:-22px',
      'left:5px',
      'padding:2px 8px',
      `background:${this.color}`,
      'color:#fff',
      'font-size:11px',
      'font-weight:600',
      'line-height:1.5',
      'border-radius:0 4px 4px 4px',   // flat bottom-left corner like Google Docs
      'white-space:nowrap',
      'pointer-events:none',
      'z-index:200',
      this.isTyping ? 'opacity:1' : 'opacity:0',
      'transition:opacity 0.12s',
      'user-select:none',
    ].join(';');

    if (!this.isTyping) {
      hit.addEventListener('mouseenter', () => { label.style.opacity = '1'; });
      hit.addEventListener('mouseleave', () => { label.style.opacity = '0'; });
    }

    hit.appendChild(line);
    hit.appendChild(flag);
    hit.appendChild(label);
    wrap.appendChild(hit);
    return wrap;
  }

  ignoreEvent() { return false; }
}

// Renders remote cursors in the editor
export function remoteCursorsExtension(ref: AwarenessRef): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    private unsub: (() => void) | null = null;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
      this.subscribe(view);
    }

    private subscribe(view: EditorView) {
      let interval: ReturnType<typeof setInterval> | null = null;
      let awarenessCleaner: (() => void) | null = null;

      const tryConnect = () => {
        if (awarenessCleaner || !ref.awareness) return;
        const handler = () => view.dispatch({ effects: cursorRefresh.of() });
        ref.awareness.on('change', handler);
        awarenessCleaner = () => ref.awareness?.off('change', handler);
        if (interval !== null) { clearInterval(interval); interval = null; }
        // Trigger an immediate rebuild now that awareness is available
        view.dispatch({ effects: cursorRefresh.of() });
      };

      tryConnect();
      if (!awarenessCleaner) {
        interval = setInterval(tryConnect, 500);
      }

      this.unsub = () => {
        if (interval !== null) { clearInterval(interval); interval = null; }
        awarenessCleaner?.();
      };
    }

    update(update: ViewUpdate) {
      const needsRebuild =
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some(tr => tr.effects.some(e => e.is(cursorRefresh)));
      if (needsRebuild) {
        this.decorations = this.build(update.view);
      }
    }

    destroy() { this.unsub?.(); }

    build(view: EditorView): DecorationSet {
      if (!ref.awareness) return Decoration.none;

      const info = view.state.field(editorInfoField, false);
      const filePath = (info as any)?.file?.path as string | undefined;
      if (!filePath) return Decoration.none;

      const docLen = view.state.doc.length;
      const now = Date.now();
      const decorations: Range<Decoration>[] = [];

      for (const [clientId, state] of ref.awareness.getStates()) {
        if (clientId === ref.localClientId) continue;
        const user = state?.user as { id: string; display_name: string; color: string } | undefined;
        const cursor = state?.cursor as RemoteCursorPos | undefined;
        const activeFile = state?.activeFile as string | null;
        if (!user || !cursor || activeFile !== filePath) continue;

        const head = Math.min(Math.max(cursor.head, 0), docLen);
        const anchor = Math.min(Math.max(cursor.anchor, 0), docLen);
        const isTyping = cursor.updatedAt > 0 && (now - cursor.updatedAt) < 3000;
        // Same-user-different-device: label as "You" instead of their name.
        const isSelf = ref.localUserId != null && user.id === ref.localUserId;
        const label = isSelf ? 'You' : user.display_name;

        // Selection range: light-tint the [anchor, head] span in the user's
        // color. Trailing "33" is ~20% alpha (matches Google Docs' feel).
        // Assumes user.color is a 6-hex value (profiles.color always is).
        if (head !== anchor) {
          const from = Math.min(head, anchor);
          const to = Math.max(head, anchor);
          decorations.push(
            Decoration.mark({
              attributes: { style: `background-color: ${user.color}33;` },
            }).range(from, to)
          );
        }

        // Caret / flag stays at head (right edge of a rightward drag,
        // left edge of a leftward drag) — matches native editor behavior.
        decorations.push(
          Decoration.widget({ widget: new CursorWidget(label, user.color, isTyping), side: 1 })
            .range(head)
        );
      }

      if (decorations.length === 0) return Decoration.none;
      // Decoration.set with `sort=true` handles both from and startSide
      // ordering. Cheaper than the pre-sort for the small counts we render.
      return Decoration.set(decorations, true);
    }
  }, { decorations: v => v.decorations });
}

// Publishes the local cursor position + typing state into awareness
export function publishCursorExtension(ref: AwarenessRef): Extension {
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!ref.awareness) return;
    if (!update.selectionSet && !update.docChanged) return;

    const sel = update.state.selection.main;

    if (update.docChanged) {
      // Mark as typing; reset after 3 s of inactivity
      ref.awareness.setLocalStateField('cursor', {
        head: sel.head,
        anchor: sel.anchor,
        updatedAt: Date.now(),
      });
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        const cur = update.view.state.selection.main;
        ref.awareness?.setLocalStateField('cursor', { head: cur.head, anchor: cur.anchor, updatedAt: 0 });
        typingTimer = null;
      }, 3000);
    } else {
      // Cursor moved but no text change — not typing
      ref.awareness.setLocalStateField('cursor', {
        head: sel.head,
        anchor: sel.anchor,
        updatedAt: typingTimer ? Date.now() : 0,
      });
    }
  });
}
