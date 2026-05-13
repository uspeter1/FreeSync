# Agent: Plugin Engineer

> See also: [[Architecture]], [[API-Reference]], [[Known-Issues]], [[Comments-Plan]]

## Role
Owns the entire Obsidian plugin (`packages/plugin/`).

## Scope
- `main.ts` — plugin lifecycle, Supabase auth, `startSync`/`stopSync`, registers CM6 extensions and views
- `sync.ts` — `SyncManager`: y-websocket providers, manifest room, vault event watchers
- `presence.ts` — `PresenceManager`: awareness → file explorer badges
- `cursors.ts` — CM6 extensions: `remoteCursorsExtension` + `publishCursorExtension`
- `sidebar.ts` — `FreeSyncSidebarView`: "FreeSync Live" right-leaf panel
- `diff.ts` — `minimalDiff` algorithm
- `comments.ts` — (next) CM6 Mark decorations + floating "add comment" button
- `comments-panel.ts` — (next) right-leaf comments panel
- `esbuild.config.mjs` — build + copy to both test vaults
- `manifest.json` — plugin metadata

## Must Not Touch
- `packages/server/`
- `packages/FreeSyncApp/`
- `packages/web/`

## Dev Loop
```bash
npm run build --workspace=packages/plugin   # builds + copies to both vaults
python3 scripts/dev-reload.py               # focuses each vault window + reloads plugin
# (no manual window-clicking needed)
```

## Input Artifacts
- [[Architecture]] — plugin file map, room naming, awareness state shape
- [[API-Reference]] — WebSocket protocol, event hooks, settings shape
- [[Design-System]] — badge rendering rules, color palette
- [[Known-Issues]] — hard-won layout rules and fixed bugs to not re-introduce
- [[Comments-Plan]] — full implementation plan for next feature

## Delivered Features (Phase 1b)

### Real-time co-editing
- One `Y.Doc` + `WebsocketProvider` per file, lazily connected on `file-open`
- `yText = doc.getText('content')` — all content mutations go through `minimalDiff`
- `LOCAL_ORIGIN` pattern prevents echo loops
- On first sync: if yText empty → seed from local file; else apply remote to local

### Presence (file explorer badges)
- `PresenceManager` reads awareness on every 'change' event
- Builds `fileUsers: Map<filePath, UserPresence[]>` from all non-local states
- Appends badge spans inside `.tree-item-inner` (force `display:flex; flex:1` first)
- `line-height: 16px` (= element height) on avatar circles — do not use flexbox centering, Obsidian's inherited line-height breaks it

### Live cursors (CM6)
- `AwarenessRef = { awareness: Awareness | null, localClientId: number }` — registered at `onload()`, populated after `startSync()`
- `remoteCursorsExtension(ref)` — `ViewPlugin` that subscribes to awareness 'change' via `StateEffect`, renders `CursorWidget` decorations filtered by `activeFile === filePath`
- `publishCursorExtension(ref)` — `EditorView.updateListener` that publishes `cursor.head/anchor/updatedAt` on every `selectionSet` or `docChanged`
- `CursorWidget.toDOM()`: zero-width anchor wrap → 12px transparent hit area → 2px cursor line → flag head (7px, `border-radius:2px 2px 2px 0`) → name label (`border-radius:0 4px 4px 4px`, shown on hover or when `isTyping`)
- **Subscribe bug fixed:** use separate `awarenessCleaner` var as "connected" guard, not `this.unsub` — otherwise the clearInterval wrapper blocks subscription when awareness connects late

### File tree sync
- `Y.Map<FileEntry>('files')` on manifest room; `FileEntry = { exists: boolean; renamedFrom?: string }`
- Create: `fileMap.set(path, { exists: true })`
- Delete: `fileMap.delete(path)`
- Rename: atomic `transact` — `delete(old)` + `set(new, { exists: true, renamedFrom: old })`
- Observer: two-pass — collect `renamedFrom` paths first, skip their 'delete' actions
- Remote rename: `fileManager.renameFile(old, new)` — keeps workspace leaves open
- Presence on rename: `onRename` calls `presence.setActiveFile(file.path)` immediately; `file-open` handler debounces null 300ms

## Key Patterns

### LOCAL_ORIGIN (critical)
```typescript
const LOCAL_ORIGIN = 'local';
doc.transact(() => { /* mutations */ }, LOCAL_ORIGIN);
doc.on('update', (_u, origin) => { if (origin === LOCAL_ORIGIN) return; /* remote only */ });
```

### AwarenessRef subscription (avoid the subscribe bug)
```typescript
// Use awarenessCleaner separate from this.unsub to avoid blocking retry
let awarenessCleaner: (() => void) | null = null;
const tryConnect = () => {
  if (awarenessCleaner || !ref.awareness) return;
  const handler = () => { /* rebuild decorations */ };
  ref.awareness.on('change', handler);
  awarenessCleaner = () => ref.awareness?.off('change', handler);
};
```

### file-open null debounce
```typescript
let clearTimer: ReturnType<typeof setTimeout> | null = null;
app.workspace.on('file-open', (file) => {
  if (file) {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    presence.setActiveFile(file.path);
  } else {
    clearTimer = setTimeout(() => { presence.setActiveFile(null); clearTimer = null; }, 300);
  }
});
```

### Supabase client (prevent session bleed)
```typescript
const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Always signInWithPassword — never getSession()
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
```

### Minimal diff
```typescript
// diff.ts
export function minimalDiff(oldText: string, newText: string) {
  let s = 0;
  while (s < oldText.length && s < newText.length && oldText[s] === newText[s]) s++;
  let oe = oldText.length, ne = newText.length;
  while (oe > s && ne > s && oldText[oe-1] === newText[ne-1]) { oe--; ne--; }
  return { index: s, deleteCount: oe - s, insertText: newText.slice(s, ne) };
}
```

## Validation
```bash
bash scripts/test-sync.sh                           # content sync + delete sync + presence badges
python3 scripts/dev-reload.py                       # reloads both vaults
obsidian eval code="document.querySelectorAll('.freesync-badge').length"  # should be > 0
```
