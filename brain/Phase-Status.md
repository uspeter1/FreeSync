# Phase Status

## Current Phase
**Phase 1a — Backend**
**Status:** Complete
**Completed by:** Backend Engineer
**Date:** 2026-05-05

## Phase History

| Phase | Name | Status | Agent | Notes |
|-------|------|--------|-------|-------|
| 0 | Bootstrap | ✅ Complete | Orchestrator | Brain vault, monorepo skeleton, GitHub infra |
| 1a | Backend | ✅ Complete | Backend Engineer | Supabase schema, relay server |
| 1b | Plugin | 🔲 Not started | Plugin Engineer | Obsidian plugin POC |
| 2 | Mobile | 🔲 Not started | Mobile Frontend Engineer | Expo app |
| 3 | Web | 🔲 Not started | Web Frontend Engineer | Next.js dashboard |
| 4 | Production | 🔲 Not started | Backend + Orchestrator | Hetzner, Docker, payments |

## What Works Right Now
- Monorepo skeleton initialized
- Brain vault populated in FreeSyncDocs and committed to /brain/
- GitHub repo created: https://github.com/uspeter1/freesync
- PR opened: phase/0-bootstrap
- scripts/test-sync.sh created (not yet run against real sync — no relay yet)
- **Supabase schema applied**: 4 tables (profiles, vaults, vault_members, vault_docs) with RLS and on_auth_user_created trigger
- **Relay server built** at packages/server/: /health, REST API (/vaults CRUD + join + members), WebSocket /sync/:vaultId?token=<jwt> with y-websocket + JWT auth gate + Yjs persistence
- `curl http://localhost:3001/health` → `{"status":"ok","ts":"..."}`
- WebSocket without token → 401
- `npm run build` exits 0 (clean TypeScript compile)

## Active Blockers
None — Plugin Engineer can begin Phase 1b immediately (relay runs on :3001).

## Next Phase
**Phase 1b: Plugin** — Plugin Engineer builds the Obsidian plugin. Relay must be running on :3001 with a real Supabase service role key in packages/server/.env.

## Key Invariants (never violate)
1. Room names: `${vaultId}/${encodeURIComponent(filePath)}` — must match exactly between relay and plugin
2. Manifest room always connected: `${vaultId}/__manifest__`
3. LOCAL_ORIGIN pattern for Yjs mutations
4. Supabase service role key is server-only
5. `box-shadow: inset 3px 0 0 <color>` not `border-left` for nav highlights
6. Badges go inside `.tree-item-inner`
7. Token refresh before WebSocket connect
8. Wait ~1s after provider open before pushing local content
9. esbuild copies plugin to BOTH test vaults
10. Minimal diff — never replace entire yText
