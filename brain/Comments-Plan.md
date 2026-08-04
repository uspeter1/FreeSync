# Inline Comments — Implementation Plan

> See also: [[Architecture]], [[API-Reference]], [[Decisions-Log]], [[Phase-Status]]

## Goal

Google Docs-style inline comments: select text → add a comment → comment card appears in a right panel anchored to the highlighted range. Multiple users see comments in real time. Clicking a comment focuses it and shows a reply input.

## Visual Spec (from Google Docs reference)

- **Text highlight:** soft yellow tint over the commented range (not bold or underlined — subtle)
- **Right panel:** comment cards stacked vertically, right-aligned to editor
- **Unfocused card:** avatar, display name, timestamp, comment text, grey background
- **Focused card:** white/elevated background, full timestamp, reply input "Reply or add others with @", ✓ resolve button + ⋮ menu
- **Selection → add comment:** floating "+" button appears at end of selection; click opens an inline composer
- **Multiple comments:** if two comments overlap vertically, the lower one is pushed down (not overlapping)
- **Resolved comments:** hidden by default, togglable

## Data Model

### Yjs Structure (inside per-file Y.Doc)

```typescript
// Top-level map in the file's Y.Doc — same doc as yText('content')
const yComments = doc.getMap<Y.Map<any>>('comments');

// Each comment is a Y.Map so individual fields can be updated (resolved, replies)
const comment = new Y.Map();
comment.set('id', crypto.randomUUID());
comment.set('authorId', userId);
comment.set('authorName', displayName);
comment.set('authorColor', color);
comment.set('text', commentText);
comment.set('from', selectionFrom);       // character offset — MVP accepts drift
comment.set('to', selectionTo);
comment.set('createdAt', Date.now());
comment.set('resolved', false);

// Replies are an append-only Y.Array of plain objects
const replies = new Y.Array<ReplyData>();
comment.set('replies', replies);

yComments.set(comment.get('id'), comment);
```

### TypeScript Types

```typescript
interface CommentData {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  from: number;           // character offset in yText
  to: number;
  createdAt: number;      // Date.now()
  resolved: boolean;
}

interface ReplyData {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
}
```

### Why Y.Map per comment (not plain object)?
- `resolved` can be toggled by any user → needs per-field CRDT (last-write-wins is fine)
- `replies` is a Y.Array → must be a nested CRDT, not a plain array
- Adding/removing comments concurrently is safe — Y.Map keys don't conflict

### Position drift (known limitation)
Character offsets `from`/`to` are absolute and drift when text is inserted before the comment range. This is accepted for MVP. Future fix: use `Y.createRelativePositionFromTypeIndex` + `Y.createAbsolutePositionFromRelativePosition` to create positions that survive edits.

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/comments.ts` | Create | CM6 extension: highlight ranges, floating add-comment button, StateEffect for rebuild |
| `src/comments-panel.ts` | Create | `ItemView` right panel listing comment cards |
| `src/sync.ts` | Modify | Expose `yComments` map from `connectFile`; add to `SyncManager` |
| `src/main.ts` | Modify | Register comments CM6 extension + panel view; pass `commentsRef` |

---

## Implementation: `comments.ts`

### CommentsRef (same pattern as AwarenessRef)

```typescript
export interface CommentsRef {
  getComments: ((filePath: string) => Y.Map<Y.Map<any>> | null) | null;
  localUser: { id: string; display_name: string; color: string } | null;
}
```

### CM6 Extension

```typescript
export function commentsExtension(ref: CommentsRef): Extension {
  return [
    commentsHighlightPlugin(ref),   // Mark decorations for comment ranges
    addCommentButtonPlugin(ref),    // Floating button on selection
  ];
}
```

### commentsHighlightPlugin

`ViewPlugin` that:
1. Reads `ref.getComments(filePath)` to get the Y.Map for the current file
2. Subscribes to `yComments.observe(handler)` — dispatches `commentsRefresh` StateEffect on change
3. In `build(view)`: iterates all non-resolved comments, creates `Decoration.mark({ class: 'freesync-comment-range', attributes: { 'data-comment-id': id } })` for each range
4. Applies sorted `DecorationSet`

CSS for the highlight:
```css
.freesync-comment-range {
  background: rgba(255, 200, 0, 0.2);
  border-bottom: 2px solid rgba(255, 200, 0, 0.6);
  cursor: pointer;
}
.freesync-comment-range.focused {
  background: rgba(255, 200, 0, 0.4);
}
```

Click handler on highlighted range → dispatch event to panel to focus that comment.

### addCommentButtonPlugin

`ViewPlugin` with `EditorView.updateListener`:
- Fires when `update.selectionSet` and selection is non-empty
- Shows a floating DOM button positioned at `view.coordsAtPos(selection.to)`
- Button style: small purple pill (`+`) absolutely positioned near cursor
- Click → opens inline composer (small input floating below the button)
- Submit → creates Y.Map comment and adds to `yComments`

Floating button DOM:
```typescript
const btn = document.createElement('button');
btn.className = 'freesync-add-comment-btn';
btn.textContent = '+';
btn.style.cssText = [
  'position:fixed',
  `top:${coords.top - 30}px`,
  `left:${coords.right + 8}px`,
  'background:#7c5cfc',
  'color:#fff',
  'border:none',
  'border-radius:50%',
  'width:24px', 'height:24px',
  'font-size:16px', 'line-height:24px',
  'text-align:center',
  'cursor:pointer',
  'z-index:1000',
].join(';');
document.body.appendChild(btn);
```

---

## Implementation: `comments-panel.ts`

```typescript
export const VIEW_TYPE_COMMENTS = 'freesync-comments';

export class CommentsPanelView extends ItemView {
  private yComments: Y.Map<Y.Map<any>> | null = null;
  private focusedCommentId: string | null = null;
  private unsub: (() => void) | null = null;
  private localUser: { id: string; display_name: string; color: string } | null = null;

  getViewType() { return VIEW_TYPE_COMMENTS; }
  getDisplayText() { return 'Comments'; }
  getIcon() { return 'message-square'; }

  attach(yComments: Y.Map<Y.Map<any>>, localUser: ...) {
    this.detach();
    this.yComments = yComments;
    this.localUser = localUser;
    const handler = () => this.render();
    yComments.observeDeep(handler);
    this.unsub = () => yComments.unobserveDeep(handler);
    this.render();
  }

  focus(commentId: string) {
    this.focusedCommentId = commentId;
    this.render();
    // Scroll focused card into view
  }

  detach() { this.unsub?.(); this.yComments = null; this.render(); }

  private render() {
    // Clear root, render cards
    // For each non-resolved comment (sorted by from position):
    //   - card with avatar, name, timestamp, text
    //   - if focused: elevated style + reply input + resolve button
    //   - click card → this.focus(id) + dispatch editor selection
  }

  private renderTimestamp(ts: number): string {
    // "2:34 PM Today" / "May 5" / "May 5, 2025"
  }

  private addReply(commentId: string, text: string) {
    const comment = this.yComments?.get(commentId);
    const replies = comment?.get('replies') as Y.Array<ReplyData>;
    replies?.push([{ id: crypto.randomUUID(), ...this.localUser, text, createdAt: Date.now() }]);
  }

  private resolveComment(commentId: string) {
    this.yComments?.get(commentId)?.set('resolved', true);
  }
}
```

---

## Implementation: `sync.ts` changes

`SyncManager` needs to:
1. Store `yComments` maps per file: `private commentsMaps = new Map<string, Y.Map<Y.Map<any>>>()`
2. In `connectFile()`: `const yComments = doc.getMap<Y.Map<any>>('comments'); this.commentsMaps.set(filePath, yComments)`
3. In `disconnectFile()`: `this.commentsMaps.delete(filePath)`
4. Expose: `getComments(filePath: string) { return this.commentsMaps.get(filePath) ?? null; }`

---

## Implementation: `main.ts` changes

```typescript
private commentsRef: CommentsRef = { getComments: null, localUser: null };

// In onload():
this.registerEditorExtension(commentsExtension(this.commentsRef));
this.registerView(VIEW_TYPE_COMMENTS, leaf => new CommentsPanelView(leaf));

// In startSync(), after syncManager.start():
this.commentsRef.getComments = (path) => this.syncManager.getComments(path);
this.commentsRef.localUser = { id: user.id, display_name: profile.display_name, color: profile.color };

// Wire panel to active file:
// On file-open: find CommentsPanelView, call panel.attach(yComments, localUser)
```

---

## Build Order

1. `sync.ts` — add `commentsMaps`, `getComments()` (no UI, just data plumbing)
2. `comments.ts` — highlight plugin first (simpler), then add-comment button
3. `comments-panel.ts` — full panel with card rendering and reply input
4. `main.ts` — wire everything together, register view
5. Style pass — ensure highlight + panel match [[Design-System]] aesthetic

---

## Sync Behaviour

Comments live in the same Yjs doc as the file content. They sync through the existing relay room automatically — no new infrastructure needed. Concurrent comment additions by multiple users are safe (Y.Map keys). Reply additions are append-only (Y.Array). Resolve is last-write-wins (Y.Map boolean) — safe because resolving is a one-way action.

---

## Known Limitations (MVP)

| Limitation | Impact | Future Fix |
|------------|--------|-----------|
| Anchor drift | `from`/`to` shift when text inserted before comment | `Y.RelativePosition` |
| No vertical alignment | Cards stack top-to-bottom, not positioned next to their text line | CSS `top` calc from `coordsAtPos` |
| No @mentions | Text is plain, no user tagging | P1 feature |
| No edit comment | Comments immutable after creation | Y.Text for comment body |
| No delete (only resolve) | Can't permanently remove a comment | `yComments.delete(id)` |

---

## Validation Checklist

- [ ] User A selects text → "+" button appears at selection end
- [ ] User A types comment → highlighted range appears in editor + card in panel
- [ ] User B sees highlight and card in real time (no reload needed)
- [ ] Clicking a card in the panel: card elevates + reply input appears + editor scrolls to range
- [ ] User B types a reply → User A sees it in real time
- [ ] Resolve button hides the comment (both users)
- [ ] Comment survives plugin reload (persisted in Yjs doc → relay persistence → Supabase)
- [ ] Multiple comments on same file render without overlapping in panel
- [ ] Comment highlight remains after editing text elsewhere in the file
