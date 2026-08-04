# API Reference

> See also: [[Architecture]], [[Supabase]]

## Relay Server

**Base URL (dev):** `ws://localhost:3001`
**Base URL (prod):** `wss://relay.freesync.app` (Phase 4)

### Health Check
```
GET /health
→ 200 { "status": "ok", "ts": "<ISO>" }
```

### WebSocket Sync
```
WS /sync/<vaultId>/<room>
Query params: ?token=<supabase_jwt>

Room paths:
  Manifest room:  sync/<vaultId>/__manifest__      (always open — global presence + file tree)
  Per-file room:  sync/<vaultId>/<filePath>        (content + cursors + comments)

Connection flow:
  1. Client connects with ?token=<jwt>
  2. Server verifies JWT via Supabase service role key
  3. Server checks vault_members: user must be active member of vaultId
  4. Missing token or non-member → HTTP 404 (relay rejects at upgrade stage)
  5. On success: y-websocket protocol takes over

Note: baseUrl = ws://localhost:3001, roomName = sync/<vaultId>/<path>
  WebsocketProvider(baseUrl, roomName, doc, { params: { token } })
```

### Yjs Document Structure (per-file room)
```typescript
const doc = new Y.Doc();

// File content — synced via minimalDiff
const yText = doc.getText('content');

// Comments — see Comments-Plan for full schema
const comments = doc.getMap<Y.Map<any>>('comments');
```

### Yjs Awareness State (per client, on manifest room)
```typescript
type AwarenessState = {
  user: {
    id: string;            // Supabase user UUID
    display_name: string;
    color: string;         // hex color from palette (assigned at registration)
    initials: string;      // 2-char uppercase initials
    activeFile: string | null;  // DEPRECATED field location — use top-level activeFile
  };
  activeFile: string | null;    // current open file path (null if no file open)
  cursor?: {
    head: number;          // CM6 cursor position (character offset)
    anchor: number;        // CM6 selection anchor (= head when no selection)
    updatedAt: number;     // Date.now() when text last changed; 0 = not typing
  };
}

// isTyping = cursor.updatedAt > 0 && (Date.now() - cursor.updatedAt) < 3000
// typing state auto-clears 3s after last keystroke via setTimeout in publishCursorExtension
```

### Manifest Y.Map 'files' (file tree)
```typescript
type FileEntry = {
  exists: boolean;
  renamedFrom?: string;  // set on rename — old path; tells remote side to rename not create
};

// All local mutations tagged LOCAL_ORIGIN to prevent echo:
manifestDoc.transact(() => {
  fileMap.set(newPath, { exists: true, renamedFrom: oldPath });  // rename
  fileMap.set(path, { exists: true });                           // create
  fileMap.delete(path);                                          // delete
}, LOCAL_ORIGIN);
```

## REST API (relay server)

### Vault Management
```
POST /vaults
  Body: { name: string }
  Auth: Bearer <jwt>
  → 201 { id, name, invite_code, owner_id, created_at }

GET /vaults
  Auth: Bearer <jwt>
  → 200 [{ id, name, invite_code, member_count, owner_id }]

POST /vaults/:vaultId/join
  Body: { invite_code: string }
  Auth: Bearer <jwt>
  → 200 { vault_id, user_id, status: "active" }

DELETE /vaults/:vaultId/members/:userId
  Auth: Bearer <jwt> (must be vault owner)
  → 204

GET /vaults/:vaultId/members
  Auth: Bearer <jwt> (must be active member)
  → 200 [{ user_id, display_name, color, status, joined_at }]
```

## Supabase Direct (client-side)

Clients use the Supabase JS client with anon key + user JWT. RLS enforces access.

**Critical:** always create client with `persistSession: false` to prevent session bleed across Electron vault windows. `autoRefreshToken: true` is safe (and required — see below) because refresh only touches the in-memory session, not localStorage. See [[Known-Issues]] and [[Decisions-Log]].

```typescript
const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: true },
});

// Auth — always sign in fresh, never use getSession()
supabase.auth.signInWithPassword({ email, password })
supabase.auth.getUser(token) → { data: { user } }

// Profile
supabase.from('profiles').select('display_name, color').eq('id', userId).single()

// Vaults
supabase.from('vaults').select('*, vault_members(count)')

// Members
supabase.from('vault_members')
  .select('*, profiles(display_name, color)')
  .eq('vault_id', vaultId)
  .eq('status', 'active')
```

## Obsidian Plugin Event Hooks

```typescript
// Vault file events
app.vault.on('create', (file) => { /* broadcast to fileMap */ })
app.vault.on('modify', (file) => { /* push minimalDiff to yText */ })
app.vault.on('delete', (file) => { /* remove from fileMap, disconnect provider */ })
app.vault.on('rename', (file, oldPath) => {
  // 1. Update presence: setActiveFile(file.path) if file was active
  // 2. Atomic transact: fileMap.delete(oldPath) + fileMap.set(file.path, { renamedFrom })
  // 3. disconnectFile(oldPath) + connectFile(file.path)
})

// Workspace events
app.workspace.on('file-open', (file: TFile | null) => {
  // null events debounced 300ms — rename causes brief null before reopening
  if (file) presence.setActiveFile(file.path)
  else setTimeout(() => presence.setActiveFile(null), 300)
})

// Remote renames: use fileManager.renameFile() not vault.rename()
// vault.rename() drops workspace leaves; fileManager.renameFile() keeps them open
app.fileManager.renameFile(oldFile, newPath)
```

## Plugin Settings Shape
```typescript
interface FreeSyncSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  relayUrl: string;     // ws://localhost:3001/sync (trailing /sync is stripped internally)
  email: string;
  password: string;     // stored in Obsidian's encrypted data.json
  vaultId: string;      // UUID from Supabase vaults table
  enabled: boolean;
}
```
