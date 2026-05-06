# Decisions Log

Record every significant architectural or product decision here. Include: what was decided, why, and what alternatives were rejected. This prevents re-litigation.

---

## 2026-05-05 — Use Yjs + y-websocket for CRDT

**Decision:** Use Yjs with y-websocket relay for real-time sync.

**Why:** Yjs is the most mature CRDT library for JavaScript, with excellent Obsidian ecosystem support (Obsidian LiveSync uses it). y-websocket gives us a simple relay model with persistence hooks. Yjs's awareness protocol handles presence out of the box.

**Rejected alternatives:**
- Automerge: Smaller ecosystem, less Obsidian precedent
- Custom diff sync (like Differential Synchronization): Requires manual conflict resolution, error-prone
- Firestore real-time: Vendor lock-in, no self-hosting, expensive at scale

---

## 2026-05-05 — Supabase for auth + persistence

**Decision:** Use Supabase (Auth + Postgres + RLS) instead of custom auth.

**Why:** Supabase gives us JWT auth, email signup, RLS policies, and a managed Postgres database with zero infrastructure work in Phase 1. Self-hosters can run their own Supabase instance.

**Rejected alternatives:**
- Custom JWT auth: Too much undifferentiated work for a POC
- Firebase: No self-hosting story, vendor lock-in
- Clerk: Great DX but adds cost and no self-hosting

---

## 2026-05-05 — Plugin + Relay built in Phase 1 (parallel)

**Decision:** Backend and Plugin engineers work in parallel in Phase 1. Plugin engineer can start once relay exposes a health endpoint, even before auth is wired.

**Why:** Decouples the plugin dev loop from Supabase complexity. Plugin can be tested locally against an unauthenticated relay first, then auth is layered in.

---

## 2026-05-05 — Manifest room for global presence

**Decision:** All clients always connect to `${vaultId}/__manifest__` in addition to per-file rooms. Presence awareness lives here.

**Why:** Without a shared room, users only see collaborators who have the exact same file open. The manifest room ensures all vault members are visible in the file explorer regardless of which file they're editing.

**Implementation:** Y.Map on `__manifest__` tracks the file tree. Yjs awareness on `__manifest__` carries all connected users.

---

## 2026-05-05 — LOCAL_ORIGIN pattern for echo prevention

**Decision:** All local Yjs mutations tagged with `LOCAL_ORIGIN = 'local'`. Remote handlers check `if (origin === LOCAL_ORIGIN) return`.

**Why:** Without this, remote change handlers fire for local changes too, causing echo loops that revert deletions and corrupt content.

**Never use:** `yText.observe()` for remote change detection — it fires for local changes.

---

## 2026-05-05 — box-shadow not border-left for nav highlights

**Decision:** Use `box-shadow: inset 3px 0 0 <color>` for file explorer presence highlights.

**Why:** Obsidian sets `padding-inline-start: !important` inline on nav items. `border-left` fights this and breaks file indentation at all nesting levels. `box-shadow` renders inside the element bounds and doesn't affect layout.

---

## 2026-05-05 — Minimal diff algorithm

**Decision:** Never delete-all + insert-all when syncing file changes. Always find common prefix/suffix and update only the changed region.

**Why:** A delete-all + insert-all creates a single massive Yjs operation that, if another client is editing simultaneously, will be flagged as a conflict and may cause merges to produce garbage content. A minimal diff produces 1-character updates for single keystrokes, making merges clean.

---

## 2026-05-05 — Docker deferred until after POC

**Decision:** No Dockerfile until Phase 1 sync POC is validated.

**Why:** Premature containerization adds complexity to a phase where fast iteration is critical. The relay will run directly on the VPS via systemd in Phase 4. Docker image is a nice-to-have for self-hosters, not a Phase 1 requirement.

---

## 2026-05-05 — Mobile priced higher than web

**Decision:** Mobile plans cost $2–4/year more than web (Plus: $12 web / $14 mobile, Pro: $24 web / $28 mobile).

**Why:** App store cut (Apple 30%, Google 15–30%) must be offset. The price delta also intentionally nudges users toward freesync.app web subscription, which is more profitable.

---

## 2026-05-05 — AGPL-3.0 license

**Decision:** AGPL-3.0 for all packages.

**Why:** Allows self-hosting, requires modifications to be open-sourced, prevents commercial forks without contributing back. Self-hosters bypass tier limits via `DISABLE_TIER_LIMITS=true` env flag.
