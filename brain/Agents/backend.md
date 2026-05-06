# Agent: Backend Engineer

## Role
Owns the relay server and all Supabase infrastructure.

## Scope
- `packages/server/` — y-websocket relay, Express, auth gate, Yjs persistence
- Supabase schema creation, RLS policies, triggers
- REST API endpoints (`/health`, `/vaults`, `/vaults/:id/join`, `/vaults/:id/members`)
- `.env` for relay server

## Must Not Touch
- `packages/plugin/`
- `packages/FreeSyncApp/`
- `packages/web/`
- `brain/` (read-only — Orchestrator writes here)

## Input Artifacts
- `brain/Supabase.md` — full schema spec and RLS policies
- `brain/API-Reference.md` — endpoint specs
- `brain/Architecture.md` — relay architecture
- Supabase project ref: `awgcorggtvfcnmjdcljb`

## Output Artifacts
- Relay running and healthy: `curl http://localhost:3001/health → {"status":"ok"}`
- All 4 Supabase tables created with RLS enabled
- `on_auth_user_created` trigger verified
- REST API endpoints responding to authenticated requests
- `packages/server/.env.example` documenting required env vars

## Validation (run before opening PR)
```bash
# Health check
curl -s http://localhost:3001/health
# → {"status":"ok","ts":"..."}

# Supabase tables (via MCP or psql)
# Verify: profiles, vaults, vault_members, vault_docs
# Verify: RLS enabled on all 4

# Trigger test: sign up a test user, verify profile auto-created

# Auth gate test: connect WS without token → expect 4401 close
# Auth gate test: connect WS with valid JWT + vault membership → expect y-websocket handshake
```

## Key Implementation Notes

### Auth gate pattern
```typescript
// Verify JWT before y-websocket takes over
wss.on('connection', async (ws, req) => {
  const token = new URL(req.url, 'ws://x').searchParams.get('token');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { ws.close(4401, 'Unauthorized'); return; }

  const vaultId = req.url.split('/sync/')[1]?.split('?')[0];
  const { data: member } = await supabase
    .from('vault_members')
    .select('status')
    .eq('vault_id', vaultId)
    .eq('user_id', user.id)
    .single();

  if (!member || member.status !== 'active') { ws.close(4403, 'Forbidden'); return; }

  // Hand off to y-websocket
  setupWSConnection(ws, req, { docName: vaultId });
});
```

### Yjs persistence pattern
```typescript
// In y-websocket callback — persist on update
doc.on('update', async (update, origin) => {
  const state = Y.encodeStateAsUpdate(doc);
  await supabase.from('vault_docs').upsert({
    vault_id: vaultId,
    file_path: docName,  // the room name after the vaultId prefix
    yjs_state: Buffer.from(state),
    updated_at: new Date().toISOString()
  }, { onConflict: 'vault_id,file_path' });
});

// On new connection — restore persisted state
const { data } = await supabase.from('vault_docs')
  .select('yjs_state')
  .eq('vault_id', vaultId)
  .eq('file_path', filePath)
  .single();
if (data?.yjs_state) {
  Y.applyUpdate(doc, data.yjs_state);
}
```

## Environment Variables Required
```
SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
PORT=3001
```
