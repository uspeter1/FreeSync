# Decisions Log

> See also: [[Architecture]], [[Known-Issues]]

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

**Why:** Decouples the plugin dev loop from Supabase complexity.

---

## 2026-05-05 — Manifest room for global presence

**Decision:** All clients always connect to `sync/${vaultId}/__manifest__` in addition to per-file rooms. Presence awareness lives on the manifest room.

**Why:** Without a shared room, users only see collaborators who have the exact same file open. The manifest room ensures all vault members are visible in the file explorer regardless of which file they're editing.

**Implementation:** `Y.Map 'files'` on `__manifest__` tracks the file tree. Yjs awareness on `__manifest__` carries all connected users' state.

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

**Why:** A delete-all + insert-all creates a single massive Yjs operation that, under concurrent editing, causes conflict merges to produce garbage. A minimal diff produces 1-character updates for single keystrokes, making merges clean.

---

## 2026-05-05 — Docker deferred until after POC

**Decision:** No Dockerfile until Phase 1 sync POC is validated.

**Why:** Premature containerization adds complexity during a phase where fast iteration is critical.

---

## 2026-05-05 — Mobile priced higher than web

**Decision:** Mobile plans cost $2–4/year more than web (Plus: $12 web / $14 mobile, Pro: $24 web / $28 mobile).

**Why:** App store cut (Apple 30%, Google 15–30%) must be offset. The price delta also nudges users toward freesync.app web subscription, which is more profitable.

---

## 2026-05-05 — AGPL-3.0 license

**Decision:** AGPL-3.0 for all packages.

**Why:** Allows self-hosting, requires modifications to be open-sourced, prevents commercial forks without contributing back.

---

## 2026-05-06 — persistSession: false to prevent Electron session bleed

**Decision:** Create Supabase client with `{ auth: { persistSession: false, autoRefreshToken: false } }` and always call `signInWithPassword` on every `startSync()`.

**Why:** All Obsidian vault windows run in the same Electron renderer and share the same `localStorage` origin. Without `persistSession: false`, one vault's Supabase session leaks into another vault window, causing User2's plugin to connect with User1's JWT. `persistSession: false` prevents writing to localStorage entirely.

**Rejected:** Using `getSession()` first then signing in — `getSession()` still reads localStorage and returns the wrong user's session.

---

## 2026-05-06 — AwarenessRef mutable object pattern for CM6 extensions

**Decision:** Pass a mutable `AwarenessRef = { awareness: Awareness | null, localClientId: number }` to CM6 extensions at registration time. Populate it after `startSync()` resolves.

**Why:** `registerEditorExtension()` must be called in `onload()` before auth completes, but awareness isn't available until `startSync()`. Passing a ref object lets extensions be registered eagerly and become functional once the ref is populated — no re-registration needed.

**Implementation detail:** The subscribe retry uses a separate `awarenessCleaner` variable (not `this.unsub`) as the "already connected" guard, avoiding a bug where setting `this.unsub` to the clearInterval wrapper caused `tryConnect()` to bail early after awareness became available.

---

## 2026-05-06 — fileManager.renameFile() not vault.rename() for remote renames

**Decision:** Remote rename operations use `app.fileManager.renameFile(oldFile, newPath)` instead of `app.vault.rename()`.

**Why:** `vault.rename()` is a low-level vault operation that doesn't update the Obsidian workspace. When the remote side renames a file the local user has open, `vault.rename()` causes the editor leaf to go blank. `fileManager.renameFile()` is the higher-level API that handles workspace leaf updates and internal link rewrites, keeping the editor open and seamlessly updating the title.

---

## 2026-05-06 — 300ms debounce on file-open null events for presence

**Decision:** When `workspace.on('file-open')` fires with `null`, wait 300ms before calling `presence.setActiveFile(null)`. If a real file-open fires within that window, cancel the null update.

**Why:** Obsidian emits `file-open null` briefly during internal transitions (rename, leaf update). Without debouncing, presence flashes to null then back, causing badge/cursor disruption visible to other users. 300ms is long enough to absorb the transition but short enough to feel immediate when a user genuinely closes all files.

---

## 2026-05-06 — Rename sync as atomic delete+add with renamedFrom marker

**Decision:** Renames are broadcast as a single Yjs transaction: `fileMap.delete(oldPath)` + `fileMap.set(newPath, { exists: true, renamedFrom: oldPath })`. The observer does a two-pass read of all changes before acting.

**Why:** A naive approach processes 'delete' before 'add' and deletes the file on the remote side before the rename context is available. The two-pass approach collects all `renamedFrom` paths first, then skips their 'delete' events, routing them through the rename branch instead.

---

## 2026-05-06 — Inline comments stored in per-file Yjs doc

**Decision:** Comments live as a `Y.Map<Y.Map>` keyed by comment ID inside the per-file Yjs doc (not a separate room, not Supabase). Each comment's replies are a `Y.Array`. See [[Comments-Plan]].

**Why:** Storing comments in the same Yjs doc as the file content means they sync through the same relay room with no extra infrastructure. Comments are CRDT-native: concurrent adds don't conflict, resolving a comment (last-write-wins boolean) is safe, and replies are an append-only list. The alternative (Supabase rows) would require REST calls and polling, breaking the real-time model.

**Tradeoff accepted:** Character offsets (`from`, `to`) drift when text is inserted before the comment range. Relative positions (Yjs `RelativePosition`) would fix this but add significant complexity. Accepted for MVP.

---

## 2026-05-06 — Binary file sync via Supabase Storage

**Decision:** Binary files (PNG, PDF, media) are uploaded to Supabase Storage bucket `vault-assets` and referenced in the manifest Y.Map as `{ binary: true, storageKey, binaryVersion }`. Text files sync via Yjs as before.

**Why:** Yjs Y.Text is not suitable for binary data. Supabase Storage gives us a CDN-backed object store that's already part of the stack. The manifest Y.Map entry acts as an event bus — when `binaryVersion` changes, receivers download the new blob. Version field prevents re-downloading unchanged binaries.

**Rejected alternatives:**
- Relay WebSocket binary frames: Adds complexity to the relay, memory pressure for large files
- Base64 in Y.Text: Bloats Yjs doc, breaks CRDT efficiency

---

## 2026-05-13 — Railway for relay hosting (over Hetzner / Fly.io)

**Decision:** Deploy the relay server to Railway rather than a VPS (Hetzner) or Fly.io.

**Why:** Railway auto-deploys from the `agent/plugin-phase1` git branch, handles TLS termination (plugin must use `wss://`), and costs ~$5/month flat on Hobby plan — predictable at personal scale. Hetzner would require manual Docker ops. Fly.io has similar DX but less mature WebSocket support.

**Live URL:** `wss://freesync-production.up.railway.app`

**Rejected alternatives:**
- Hetzner VPS: Cheaper at scale but requires manual Docker/Caddy ops at setup time
- Fly.io: Similar DX but no clear cost advantage and less Railway ecosystem familiarity

---

## 2026-05-13 — Node 22 required in Docker image

**Decision:** Relay Dockerfile uses `FROM node:22-alpine`, not `node:20-alpine`.

**Why:** `@supabase/realtime-js` uses the global `WebSocket` constructor directly. Node 20 does not include native WebSocket support (it was experimental). Node 22 ships native WebSocket as a stable built-in. The server throws `Error: Node.js detected without native WebSocket support` at startup on Node 20.

---

## 2026-05-13 — Multi-device presence by design (no deduplication)

**Decision:** No user-ID-based deduplication in awareness. The same user on two devices appears as two separate presence indicators.

**Why:** Yjs awareness assigns a random `clientID` per WebSocket connection, not per user. This is intentional — each connection represents an independent editing context. If a user edits file A on a laptop and file B on a phone, both presence states are correct and useful. Deduplication would hide real state.

**Never add:** User-ID-based awareness deduplication. It would break legitimate multi-device workflows and is not how Yjs awareness is designed.

---

## 2026-05-13 — Cursor presence protection in CLAUDE.md

**Decision:** Added a "Cursor Presence — Do Not Break" section to CLAUDE.md with an explicit pre-commit checklist.

**Why:** The `box-shadow: inset 3px 0 0 <color>` color bar in `presence.ts renderFileBadge()` and the matching `boxShadow = ''` reset in `clearBadges()` were accidentally removed during comments panel work — for the second time. The CM6 `awarenessCleaner` guard pattern was also previously broken. These bugs are subtle (the badge renders without the color bar; the guard prevents retry on late awareness connect). Explicit CLAUDE.md invariants are the only reliable prevention.

**Hard invariants documented:**
1. `renderFileBadge()` must set `inner.style.boxShadow = 'inset 3px 0 0 <color>'`
2. `clearBadges()` must reset `inner.style.boxShadow = ''`
3. `cursors.ts` subscribe guard: use `awarenessCleaner` variable, not `this.unsub`
4. `awarenessRef` wired in `startSync()` after `syncManager.start()`, cleared in `stopSync()`
5. Never call `getBoundingClientRect()` inside CM6 `update()` — forces synchronous reflow
