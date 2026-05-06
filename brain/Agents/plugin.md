# Agent: Plugin Engineer

## Role
Owns the entire Obsidian plugin.

## Scope
- `packages/plugin/main.ts` — plugin lifecycle, settings, auth, provider management
- `packages/plugin/sync.ts` — Yjs doc management, y-websocket providers, file watching
- `packages/plugin/presence.ts` — awareness state, badge rendering, active user panel
- `packages/plugin/diff.ts` — minimal diff algorithm
- `packages/plugin/esbuild.config.mjs` — build + copy to both test vaults
- `packages/plugin/manifest.json` — plugin metadata

## Must Not Touch
- `packages/server/`
- `packages/FreeSyncApp/`
- `packages/web/`

## Dependencies
- Relay must be running on `:3001` before plugin can be tested
- Supabase anon key must be available (from Supabase dashboard or Backend Engineer)

## Input Artifacts
- `brain/Architecture.md` — plugin file structure and Yjs patterns
- `brain/API-Reference.md` — WebSocket protocol, awareness state shape, settings shape
- `brain/Design-System.md` — badge rendering rules (box-shadow, .tree-item-inner placement)
- Relay URL: `ws://localhost:3001/sync`
- Supabase URL + anon key

## Output Artifacts
- Plugin installed in `/home/peter/FreeSyncUser1/.obsidian/plugins/freesync/`
- Plugin installed in `/home/peter/FreeSyncUser2/.obsidian/plugins/freesync/`
- `scripts/test-sync.sh` passing: content sync ✅, deletion sync ✅, presence badges ✅

## Validation (run before opening PR)
```bash
bash scripts/test-sync.sh
obsidian dev:errors vault="FreeSyncUser1"      # must be empty
obsidian dev:errors vault="FreeSyncUser2"      # must be empty
obsidian dev:dom selector=".freesync-badge" all vault="FreeSyncUser1"
```

## Key Implementation Notes

### manifest.json
```json
{
  "id": "freesync",
  "name": "FreeSync",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Real-time collaborative sync for Obsidian",
  "author": "FreeSync",
  "isDesktopOnly": false
}
```

### esbuild copies to BOTH vaults
```javascript
// esbuild.config.mjs
const VAULT1 = '/home/peter/FreeSyncUser1/.obsidian/plugins/freesync';
const VAULT2 = '/home/peter/FreeSyncUser2/.obsidian/plugins/freesync';

// After build: copy main.js + manifest.json to both
```

### LOCAL_ORIGIN pattern (critical — prevents echo loops)
```typescript
const LOCAL_ORIGIN = 'local';

// Writing local changes:
doc.transact(() => {
  yText.delete(start, length);
  yText.insert(start, newContent);
}, LOCAL_ORIGIN);

// Remote change handler:
doc.on('update', (update, origin) => {
  if (origin === LOCAL_ORIGIN) return;  // skip our own changes
  // apply remote change to editor
});
```

### Token refresh before connecting
```typescript
// In onload() or when enabling sync:
await supabase.auth.refreshSession();
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;
const ws = new WebSocketProvider(`${relayUrl}/${vaultId}?token=${token}`, roomName, doc);
```

### Wait before pushing local content
```typescript
provider.on('sync', (isSynced) => {
  if (!isSynced) return;
  setTimeout(() => {
    if (yText.toString() === '') {
      // Safe to insert local file content
      doc.transact(() => { yText.insert(0, localContent); }, LOCAL_ORIGIN);
    }
  }, 1000);
});
```

### Presence badge placement
```typescript
// Find the .tree-item-inner for a file in the explorer
const inner = navItem.querySelector('.tree-item-inner');
// Append badge INSIDE .tree-item-inner (not the outer div)
const badge = document.createElement('span');
badge.className = 'freesync-badge';
badge.style.cssText = `
  display: inline-flex; align-items: center; gap: 2px;
  margin-left: auto; flex-shrink: 0;
`;
inner.appendChild(badge);
// Apply inset box-shadow to .tree-item-inner for color bar:
inner.style.boxShadow = `inset 3px 0 0 ${color}`;
```

### Minimal diff algorithm
```typescript
// diff.ts
export function minimalDiff(oldText: string, newText: string) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length, newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd-1] === newText[newEnd-1]) { oldEnd--; newEnd--; }
  return {
    index: start,
    deleteCount: oldEnd - start,
    insertText: newText.slice(start, newEnd)
  };
}
```
