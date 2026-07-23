# FreeSync — Claude Code Project Guide

> "The Google Docs for Obsidian" — real-time collaborative editing for Obsidian vaults.

---

## What This Is

FreeSync is a monorepo. All active development is in the Obsidian plugin (`packages/plugin/`). The relay server and mobile app are complete for their current phases.

| Package | Path | Status |
|---------|------|--------|
| Relay server | `packages/server/` | Phase 1a complete — do not touch |
| Obsidian plugin | `packages/plugin/` | Active development |
| Mobile app | `packages/FreeSyncApp/` | Phase 2+ — do not touch |

**Active branch:** `agent/plugin-phase1`

---

## The Brain Vault

`brain/` is the canonical source of truth for design decisions, architecture, and feature plans. **Read it before writing any code.** As you make changes to the architecture and features, log those changes and **note your mistakes so you don't make them again.** You may use the Obsidian CLI to review the brain or read the md files directly.

| File | What it covers |
|------|---------------|
| `brain/Phase-Status.md` | Current phase, what's built, roadmap priority order |
| `brain/Architecture.md` | System diagram, room naming, presence architecture, plugin file map |
| `brain/Decisions-Log.md` | Every significant architectural decision and why — check before re-litigating anything |
| `brain/Known-Issues.md` | Active bugs, WONTFIX rules, hard-won layout invariants |
| `brain/API-Reference.md` | WebSocket protocol, REST endpoints, room path format |
| `brain/Design-System.md` | Badge colors, avatar rules, CSS conventions |
| `brain/Comments-Plan.md` | Inline comments feature spec and implementation checklist |
| `brain/Feature-Roadmap.md` | Full prioritized feature list |
| `brain/Agents/plugin.md` | Plugin Engineer full scope, key patterns, delivered features |
| `brain/Agents/backend.md` | Backend Engineer scope (relay + Supabase) |
| `brain/Agents/frontend-mobile.md` | Mobile Engineer scope |
| `brain/Agents/frontend-web.md` | Web Engineer scope (Phase 3) |
| `brain/Agents/orchestrator.md` | Orchestrator role |
| `brain/Agents/qa.md` | QA Engineer role |

---

## Agent Team

Each agent owns a slice of the monorepo and must not touch others' packages. See `brain/Agents/<role>.md` for full scope, patterns, and invariants for each role.

| Agent | Owns | Active? |
|-------|------|---------|
| **Plugin Engineer** | `packages/plugin/src/` | ✅ Yes — you, most sessions |
| Backend Engineer | `packages/server/` | Phase 1a complete |
| Mobile Frontend Engineer | `packages/FreeSyncApp/` | Phase 2 |
| Web Frontend Engineer | `packages/web/` | Phase 3 |
| QA Engineer | `scripts/`, validation | On demand |
| Orchestrator | Coordinates all agents | On demand |

---

## Dev Loop

```bash
# 1. Verify relay is running
curl http://localhost:3001/health
# If not: cd packages/server && npm run dev

# 2. Build plugin + deploy to both test vaults
npm run build --workspace=packages/plugin

# 3. Reload plugin in both Obsidian windows
python3 scripts/dev-reload.py
# Focuses each vault window via Win32 EnumWindows API, then disables/enables the plugin.
# Reload one vault: python3 scripts/dev-reload.py FreeSyncUser1
```

**Test vaults:**
- `/home/peter/FreeSyncUser1` — `user1@freesync.test`
- `/home/peter/FreeSyncUser2` — `user2@freesync.test`
- Shared vaultId: `e49ed7f7-6c8a-4329-b8e9-1bfaea4be449`

**Creating fresh test accounts (Gmail plus-alias trick):**

Gmail (and most modern mail providers) ignore everything between `+` and `@` for delivery — `appdev+anything@mattjones.org` all land in the `appdev@mattjones.org` inbox, but Supabase treats them as distinct accounts. Use this to spin up throwaway test users without registering new mailboxes:

```
appdev+freesync-alice@mattjones.org
appdev+freesync-bob@mattjones.org
appdev+freesync-<whatever>@mattjones.org
```

**Bypass the email confirmation step** with Supabase's admin API (needs `SUPABASE_SERVICE_ROLE_KEY`, already in `packages/server/.env`) — the confirmation email would land in Peter's real inbox otherwise:

```bash
SR=<service role key>
# Create pre-confirmed account (no email at all):
curl -s -X POST "https://awgcorggtvfcnmjdcljb.supabase.co/auth/v1/admin/users" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
  -d '{"email":"appdev+freesync-X@mattjones.org","password":"testpass123","email_confirm":true,"user_metadata":{"display_name":"X"}}'

# Or confirm an already-created account:
curl -s -X PUT "https://awgcorggtvfcnmjdcljb.supabase.co/auth/v1/admin/users/<user-id>" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
  -d '{"email_confirm":true}'
```

Sign-in works with the full plus-alias email + password. Don't hammer the public `/auth/v1/signup` endpoint — it has a per-domain email-send rate limit; the admin path skips email entirely.

**Gotcha:** `obsidian eval --vault <name>` targets whichever window has focus, not the named vault. Always use `scripts/dev-reload.py` which focuses the correct window first.

---

## Where to Find Critical Invariants

Before writing any plugin code, read:

1. **`brain/Known-Issues.md`** — hard-won layout rules (box-shadow vs border-left, badge placement, avatar centering) and fixed bugs not to reintroduce
2. **`brain/Phase-Status.md`** — the invariants list at the bottom covers session bleed fix, LOCAL_ORIGIN, minimal diff, and more
3. **`brain/Agents/plugin.md`** — CM6 patterns, AwarenessRef/CommentsRef patterns, subscribe race fix

These are the authoritative sources. Do not rely on memory of invariants — read the brain.

---

## Cursor Presence — Do Not Break

This feature has been accidentally broken multiple times. Before touching `presence.ts`, `cursors.ts`, or the awareness wiring in `main.ts`, read this section in full.

### Two separate systems

| System | Files | What it shows |
|--------|-------|---------------|
| **File-explorer presence** | `presence.ts` | Colored left bar + avatar badges on nav items — shows which file each remote user has open |
| **In-editor live cursors** | `cursors.ts` | Colored cursor lines + name labels in the CM6 editor — shows where remote users' cursors are |

Both depend on the **manifest room awareness** (`manifestProvider.awareness`). Do not replace or reset this awareness object.

### Hard invariants — never change these

**`presence.ts` — `renderFileBadge()`**
```typescript
// REQUIRED — inset box-shadow, NEVER border-left (breaks Obsidian indentation)
inner.style.boxShadow = `inset 3px 0 0 ${users[0].color}`;
```

**`presence.ts` — `clearBadges()`**
```typescript
// REQUIRED — must clear boxShadow when removing badges
inner.style.boxShadow = '';
```

**`cursors.ts` — `subscribe()` guard**
```typescript
// REQUIRED — use awarenessCleaner (not this.unsub) as the "already connected" guard
// Using this.unsub blocks retry when awareness connects late (known bug, fixed 2026-05-06)
let awarenessCleaner: (() => void) | null = null;
const tryConnect = () => {
  if (awarenessCleaner || !ref.awareness) return;  // ← guard is awarenessCleaner
  ...
};
```

**`main.ts` — awareness wiring in `startSync()`**
```typescript
// REQUIRED — must set both fields on awarenessRef after syncManager.start()
if (this.syncManager.manifestProvider) {
  const aw = this.syncManager.manifestProvider.awareness;
  this.awarenessRef.awareness = aw;       // ← enables cursor polling
  this.awarenessRef.localClientId = aw.clientID;  // ← filters own cursor out
}
```

**`main.ts` — cursor extensions registered in `onload()`, not `startSync()`**
```typescript
// REQUIRED — registered once at load, awareness is wired in later
this.registerEditorExtension(remoteCursorsExtension(this.awarenessRef));
this.registerEditorExtension(publishCursorExtension(this.awarenessRef));
```

**`main.ts` — awareness cleared in `stopSync()`**
```typescript
// REQUIRED — null out so cursor plugin stops publishing on disconnect
this.awarenessRef.awareness = null;
```

### Checklist before committing any change to these files

- [ ] `presence.ts`: `renderFileBadge()` still sets `inner.style.boxShadow`
- [ ] `presence.ts`: `clearBadges()` still clears `inner.style.boxShadow`
- [ ] `cursors.ts`: `subscribe()` uses `awarenessCleaner` (not `this.unsub`) as guard
- [ ] `main.ts`: `awarenessRef.awareness` and `localClientId` set in `startSync()`
- [ ] `main.ts`: `awarenessRef.awareness = null` in `stopSync()`
- [ ] Build passes: `npm run build --workspace=packages/plugin`
- [ ] Reload both vaults: `python3 scripts/dev-reload.py`
