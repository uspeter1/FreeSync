# Validation Results

Record actual CLI output from each phase's validation runs here. Paste verbatim — do not summarize.

---

## Phase 0 — Bootstrap

**Date:** 2026-05-05
**Agent:** Orchestrator

### Success Criteria Checks

```
$ obsidian search query="Supabase" vault="FreeSyncDocs"
[results — run after brain vault populated]

$ obsidian read file="Phase-Status" vault="FreeSyncDocs"
[content — run after brain vault populated]

$ bash -n scripts/test-sync.sh
[no output = pass]

$ find packages -name "*.ts" -not -path "*/prototype/*" | wc -l
0
```

*Full validation output will be pasted here after bootstrap completes.*

---

## Phase 1a — Backend

**Date:** 2026-05-05
**Agent:** Backend Engineer

### Supabase table verification (MCP list_tables)

```
Tables confirmed in public schema (all with RLS enabled):
- public.profiles    (id, display_name, color, tier, stripe_customer_id, created_at)
- public.vaults      (id, owner_id, name, invite_code, created_at)
- public.vault_members (vault_id, user_id, status, joined_at) — PK: (vault_id, user_id)
- public.vault_docs  (id, vault_id, file_path, yjs_state, updated_at)

RLS enabled: true on all 4 tables
Migration: initial_schema — success: true
```

### Health check

```
$ curl -s http://localhost:3001/health
{"status":"ok","ts":"2026-05-06T00:55:21.831Z"}
```

### WebSocket auth gate (no token → 401)

```
$ curl -s -o /dev/null -w "%{http_code}" \
  -H "Upgrade: websocket" -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  -H "Sec-WebSocket-Version: 13" \
  "http://localhost:3001/sync/test-vault-id"
401
```

### TypeScript build

```
$ npm run build --workspace=packages/server
> @freesync/server@0.0.0 build
> tsc
[exits 0 — no errors]
```

---

## Phase 1b — Plugin

*Not yet run.*

---

## Phase 2 — Mobile

*Not yet run.*

---

## Phase 3 — Web

*Not yet run.*
