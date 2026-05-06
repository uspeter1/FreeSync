# FreeSync — Session Primer
**Last updated:** 2026-05-05
**Phase completed:** 1a — Backend
**Completed by:** Backend Engineer

## What Works Right Now
The Supabase schema is fully applied: 4 tables (profiles, vaults, vault_members, vault_docs) with RLS enabled and an `on_auth_user_created` trigger that auto-creates a color-assigned profile for every new user. The relay server is built at `packages/server/` and runs on port 3001. It exposes `GET /health`, a REST API for vault management (`POST /vaults`, `GET /vaults`, `POST /vaults/:id/join`, `GET /vaults/:id/members`, `DELETE /vaults/:id/members/:userId`), and a WebSocket endpoint at `ws://localhost:3001/sync/<vaultId>?token=<jwt>` that enforces JWT auth and active-membership checks before connecting, then hands off to y-websocket for CRDT relay with debounced Yjs state persistence to the `vault_docs` table.

## Relay
ws://localhost:3001/sync

## Supabase project
https://awgcorggtvfcnmjdcljb.supabase.co
Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Z2NvcmdndHZmY25tamRjbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTIwNjAsImV4cCI6MjA5MzU4ODA2MH0.Ymb_EpVaNxPZa4M-dgCIbw2t6taY8YEjA8pw9Q8n3cI

## FreeSyncUser1 vault path
/home/peter/FreeSyncUser1

## FreeSyncUser2 vault path
/home/peter/FreeSyncUser2

## Next agent: Plugin Engineer

You are the Plugin Engineer. Read brain/Agents/plugin.md for your full scope.

### First 3 actions
1. Check that relay is running: `curl http://localhost:3001/health`
2. If relay is not running: `cd packages/server && npm run dev` (requires .env with real service role key — get it from Supabase dashboard → Settings → API → service_role)
3. Read brain/Agents/plugin.md fully before writing any code

### Do not touch
- packages/server/
- packages/FreeSyncApp/
- brain/ (read-only)

### Your branch
agent/plugin-phase1

### Deliverables
- `packages/plugin/main.ts` — plugin lifecycle, settings, auth, provider management
- `packages/plugin/sync.ts` — Yjs doc management, y-websocket providers, file watching
- `packages/plugin/presence.ts` — awareness state, badge rendering, active user panel
- `packages/plugin/diff.ts` — minimal diff algorithm
- `packages/plugin/esbuild.config.mjs` — build + copy to both test vaults
- `packages/plugin/manifest.json` — plugin metadata
- Plugin installed in `/home/peter/FreeSyncUser1/.obsidian/plugins/freesync/`
- Plugin installed in `/home/peter/FreeSyncUser2/.obsidian/plugins/freesync/`
- `scripts/test-sync.sh` passing: content sync, deletion sync, presence badges

### Key implementation notes
- Room name format: `${vaultId}/${encodeURIComponent(filePath)}` — must match relay exactly
- Manifest room: `${vaultId}/__manifest__` always connected
- LOCAL_ORIGIN pattern prevents echo loops (see brain/Agents/plugin.md)
- Token refresh before WebSocket connect (Supabase session may expire)
- Wait ~1s after provider sync before pushing local content
- esbuild must copy main.js + manifest.json to BOTH test vaults

## Last validation output (Phase 1a)

```
$ curl -s http://localhost:3001/health
{"status":"ok","ts":"2026-05-06T00:55:21.831Z"}

$ curl -s -o /dev/null -w "%{http_code}" \
  -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  -H "Sec-WebSocket-Version: 13" \
  "http://localhost:3001/sync/test-vault-id"
401

$ npm run build --workspace=packages/server
> @freesync/server@0.0.0 build
> tsc
[exits 0]

Supabase tables (all RLS enabled):
- public.profiles
- public.vaults
- public.vault_members
- public.vault_docs
Migration initial_schema: success
```

## Open issues
None.
