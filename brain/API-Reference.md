# API Reference

## Relay Server

**Base URL:** `ws://localhost:3001` (dev) / `wss://relay.freesync.app` (prod)

### Health Check
```
GET /health
→ 200 {"status":"ok","ts":"<ISO>"}
```

### WebSocket Sync
```
WS /sync/:vaultId
Query params: ?token=<supabase_jwt>

Connection flow:
1. Client connects with ?token=<jwt>
2. Server verifies JWT via Supabase service role key
3. Server checks vault_members: user must be active member of vaultId
4. On auth failure: close(4401, "Unauthorized")
5. On success: y-websocket protocol takes over

Room naming:
  Manifest:  ${vaultId}/__manifest__          (always connected — global presence)
  Per-file:  ${vaultId}/${encodeURIComponent(filePath)}  (content sync + cursors)
```

### Yjs Awareness State (per client)
```typescript
type AwarenessState = {
  user: {
    id: string;
    display_name: string;
    color: string;       // hex from PALETTE
    initials: string;    // 2 chars
  };
  activeFile: string | null;  // current open file path
  cursor?: {
    anchor: number;
    head: number;
  };
}
```

## REST API (relay server — Phase 1)

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

```typescript
// Auth
supabase.auth.signUp({ email, password, options: { data: { display_name } } })
supabase.auth.signInWithPassword({ email, password })
supabase.auth.getSession() → { session: { access_token } }
supabase.auth.refreshSession()

// Profile
supabase.from('profiles').select('*').eq('id', userId).single()

// Vaults
supabase.from('vaults').select('*, vault_members(count)').eq('vault_members.user_id', userId)

// Members
supabase.from('vault_members')
  .select('*, profiles(display_name, color)')
  .eq('vault_id', vaultId)
  .eq('status', 'active')
```

## Obsidian Plugin Events

### Vault events watched
```typescript
this.app.vault.on('create', handler)    // file created → sync to manifest Y.Map
this.app.vault.on('modify', handler)    // file modified → update yText
this.app.vault.on('delete', handler)    // file deleted → remove from manifest
this.app.vault.on('rename', handler)    // file renamed → update manifest key
```

### Settings shape
```typescript
interface FreeSyncSettings {
  supabaseUrl: string;
  supabaseAnonKey: string;
  relayUrl: string;
  vaultId: string;        // UUID from Supabase vaults table
  email: string;
  enabled: boolean;
}
```
