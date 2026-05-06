# FreeSync — Session Primer
**Last updated:** 2026-05-05
**Phase completed:** 0 — Bootstrap
**Completed by:** Orchestrator

## What Works Right Now
The monorepo skeleton is in place. Brain vault is fully populated in both FreeSyncDocs (Obsidian vault) and committed to /brain/. GitHub repo is set up with labels, issue templates, and PR template. No application code exists — only stubs and docs. The relay server, Obsidian plugin, and mobile app are all empty package.json stubs waiting for implementation.

## Environment
**Relay:** Not yet built — your job is to create it at `packages/server/`, port 3001
**Supabase project:** `awgcorggtvfcnmjdcljb`
**Supabase URL:** `https://awgcorggtvfcnmjdcljb.supabase.co`
**FreeSyncUser1 vault path:** `/home/peter/FreeSyncUser1`
**FreeSyncUser2 vault path:** `/home/peter/FreeSyncUser2`

## Next Agent: Backend Engineer

You are the **Backend Engineer**. Read `brain/Agents/backend.md` for your full scope.

### First 3 Actions
1. Get the Supabase service role key: Supabase dashboard → Project Settings → API → service_role key
2. Apply the full schema from `brain/Supabase.md` via Supabase MCP (`apply_migration`)
3. Verify all 4 tables created with RLS enabled via `list_tables` MCP tool

### Do Not Touch
- `packages/plugin/` — Plugin Engineer's territory
- `packages/FreeSyncApp/` — Mobile Engineer's territory
- `brain/` docs — Orchestrator writes these

### Your Deliverables
1. Supabase schema: 4 tables, RLS on all, `on_auth_user_created` trigger
2. Relay server at `packages/server/`:
   - `GET /health` → `{"status":"ok"}`
   - `WS /sync/:vaultId?token=<jwt>` — y-websocket with auth gate
   - Yjs state persistence to `vault_docs` table
3. REST API: `POST /vaults`, `GET /vaults`, `POST /vaults/:id/join`, `GET /vaults/:id/members`
4. `packages/server/.env.example` with all required vars documented

### Validation Before Opening PR
```bash
curl -s http://localhost:3001/health            # → {"status":"ok","ts":"..."}
# Supabase: list_tables → confirm profiles, vaults, vault_members, vault_docs
# Test WS without token → expect close(4401)
# Test signup → confirm profile auto-created with color from palette
```

### Brain Vault Files to Read
- `brain/Supabase.md` — complete schema and RLS policies (copy-paste ready)
- `brain/Architecture.md` — relay architecture, environment variables
- `brain/API-Reference.md` — endpoint specs and Yjs persistence patterns
- `brain/Agents/backend.md` — implementation notes, code patterns

### Branch
Work on branch: `agent/backend-phase1`

### When Done
1. Run validation above, paste output
2. Update `brain/Phase-Status.md` (Phase 1a: Complete)
3. Write new `primer.md` addressed to Plugin Engineer
4. `git push && gh pr create --title "Phase 1a: Backend — Supabase schema + relay server"`
5. QA agent reviews before human merge

## Last Validation Output (Phase 0)
```
$ obsidian search query="Supabase" vault="FreeSyncDocs"
Agents/qa.md
Agents/frontend-web.md
Agents/frontend-mobile.md
Agents/plugin.md
Agents/backend.md
Agents/orchestrator.md
Supabase.md
Validation-Results.md
Decisions-Log.md
API-Reference.md

$ obsidian read file="Phase-Status" vault="FreeSyncDocs"
# Phase Status
## Current Phase
**Phase 0 — Bootstrap**
**Status:** Complete
...

$ bash -n scripts/test-sync.sh
[no output — syntax OK]

$ find packages -name "*.ts" -not -path "*/prototype/*" | wc -l
0
```

## Open Issues
None — clean slate.
