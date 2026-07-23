# Known Issues

> See also: [[Decisions-Log]], [[Phase-Status]]

Track bugs, tech debt, workarounds, and deferred work here. Every agent should check this before starting and update it when they discover or fix issues.

Format: `- [STATUS] Description — discovered/fixed on [date]`

Status values: `[OPEN]` `[IN PROGRESS]` `[FIXED]` `[DEFERRED]` `[WONTFIX]`

---

## Phase 1b — Plugin

- `[FIXED]` **Electron session bleed** — User2's plugin connected with User1's JWT because all vault windows share `localStorage` origin. Fixed 2026-05-06: `persistSession: false, autoRefreshToken: false`; always `signInWithPassword`. See [[Decisions-Log]].

- `[FIXED]` **AwarenessRef subscribe race** — CM6 cursor extension's interval retry used `this.unsub` as "already connected" guard, but `this.unsub` was set to clearInterval wrapper before awareness connected, causing `tryConnect()` to bail early. Remote cursors never updated. Fixed 2026-05-06: separate `awarenessCleaner` variable.

- `[FIXED]` **Presence cleared on rename** — `file-open null` fired briefly during workspace leaf update on rename, clearing `activeFile` in awareness. Fixed 2026-05-06: 300ms debounce on null events in `onFileOpen`. See [[Decisions-Log]].

- `[FIXED]` **Rename vs delete confusion in manifest observer** — remote rename processed 'delete' for old path before 'add' for new path, deleting the file. Fixed 2026-05-06: two-pass observer collects `renamedFrom` paths first. See [[Decisions-Log]].

- `[FIXED]` **Other user kicked out of file on remote rename** — `vault.rename()` dropped workspace leaves. Fixed 2026-05-06: use `fileManager.renameFile()`. See [[Decisions-Log]].

- `[FIXED]` **activeFile null after plugin reload** — `file-open` doesn't re-fire for already-open files after plugin reload; `start()` never set `activeFile`. Fixed 2026-05-06: `start()` calls `presence.setActiveFile(activeFile?.path ?? null)` immediately after `watchVault()`.

- `[KNOWN]` **Yjs duplicate import warning** — Obsidian or another plugin also imports Yjs, triggering Yjs's constructor check warning. Symptom: `[error] Yjs was already imported...` in console on every plugin reload. Does not affect functionality — sync, presence, and cursors all work correctly. `[WONTFIX]` for now; would require externalizing all Yjs modules in esbuild config and relying on Obsidian's bundled version.

- `[DEFERRED]` **Comment anchor drift** — comment `from`/`to` character offsets drift when text is inserted before the comment range. Yjs `RelativePosition` would fix this but adds complexity. Accepted for comments MVP. See [[Comments-Plan]].

- `[KNOWN]` **Comments panel not auto-opened** — the panel is an ItemView that must be opened manually via the ribbon icon (message-square). There is no auto-open when a file with comments is opened. Future: auto-reveal when file has comments.

- `[FIXED]` **Relay was write-only against `vault_docs`** — the persistence handler wrote every Yjs update to Supabase but never loaded state back. After a relay restart (Railway redeploy) with no clients connected, the next client to join got an empty `Y.Doc`; that empty CRDT state could then merge into peers and surface as missing files or content reverting to an older version. Root cause of a real school-file loss incident. Fixed 2026-07-22 (commit b2597d0): added `setPersistence({ bindState, writeState })` so the relay loads `vault_docs` into fresh `Y.Doc`s before the sync handshake. `decodeYjsState()` handles the historical double-JSON-encoded BYTEA storage shape. **Never remove `bindState`.**

- `[FIXED]` **`vault.delete` on receiver = permanent unlink** — the manifest observer's delete branch called `this.app.vault.delete(file)`, which is Obsidian's permanent unlink (no trash). A single spurious remote delete was unrecoverable. Fixed 2026-07-22 (commit b2597d0): switched to `this.app.vault.trash(file, true)` in `packages/plugin/src/sync.ts`. **Never revert to `vault.delete()` on the receive path** — even if every other safeguard fails, `trash()` keeps deletions recoverable from OS trash.

- `[FIXED]` **OneDrive/Dropbox/iCloud transient triggered permanent delete** — cloud-sync engines routinely blip a file off disk for a fraction of a second mid-sync. Obsidian's watcher reported this as `delete`, which propagated to every peer in milliseconds. Fixed 2026-07-22 (commit b2597d0): `DeleteDebouncer` in `packages/plugin/src/delete-debounce.ts` holds deletes for 3s; `onCreate` cancels the pending delete when the file reappears; the manifest observer also cancels when a remote peer says the file exists; a fire-time `fileExists()` re-check aborts propagation defensively. 12/12 unit tests in `delete-debounce.test.ts` (run with `npx tsx --test packages/plugin/src/delete-debounce.test.ts`).

- `[FIXED]` **Ghost-restoration of deleted files** — `vault_docs` was keyed on `(vault_id, file_path)` and deletes propagated only via the manifest; the per-file row was never purged. A later create with the same path (e.g. two "Untitled.md" in a row) re-loaded the orphan content into the new `Y.Doc` via `bindState`. Fixed 2026-07-22 (commit 9f0a259): live cascade observer on `__manifest__`'s `files` Y.Map destroys the in-memory per-file `Y.Doc` and deletes the row on real deletes (skipping renames via the same `renamedFrom` pattern the plugin uses). Defensive per-file `bindState` consults `manifestHasFile(vaultId, filePath)` before loading — catches orphans from before this fix. `BIND_STATE_ORIGIN` symbol tags the late-arriving DB load so the manifest observer doesn't fire phantom cascades from CRDT reconciliation. `purgedDocs` set (marked synchronously before any await) prevents a near-simultaneous `writeState` from resurrecting a just-deleted row. All three guards are load-bearing; end-to-end test in `scripts/repro-ghost-restore.mjs` (8/8 assertions).

- `[KNOWN]` **y-websocket does not await `bindState`** — clients can send updates while the DB load is in flight. **Every handler (`ydoc.on('update')`, `files.observe()`) must be attached BEFORE any `await` in `bindState`** or the first user write is silently dropped. The bindState load is tagged with `BIND_STATE_ORIGIN` so those handlers can ignore CRDT reconciliation events without ignoring real user changes. Discovered 2026-07-22 while writing the ghost-restore repro (the first draft attached handlers after the manifest lookup and lost the initial write in every run).

---

## Architectural Debt

- `[DEFERRED]` Docker image for self-hosters — Phase 4
- `[DEFERRED]` Stripe + RevenueCat payment wiring — Phase 4
- `[DEFERRED]` Next.js web dashboard (`packages/web/`) — Phase 3
- `[DEFERRED]` File browser in mobile app — Phase 2 doesn't include file browsing
- `[DEFERRED]` FCM push notifications — Phase 4+
- `[DEFERRED]` @mentions — P1 feature, after comments
- `[DEFERRED]` Version history / snapshots — P2 feature, after comments
- `[DEFERRED]` Share link + invite by email — P1, requires email infra
- `[DEFERRED]` **File history / recoverable deletions** — the ghost-restore fix intentionally purges deleted content rather than preserving it. A separate feature could add a `vault_doc_versions` table + `INSERT ... SELECT` before each cascade-delete, plus a restoration UX. Discussed 2026-07-22, not yet planned.
- `[DEFERRED]` **Vault_docs orphan-row GC** — the defensive `bindState` path deliberately does NOT clean orphan rows (a fire-and-forget DELETE races with the next upsert and can wipe fresh content). Orphans are harmless (never loaded again) but accumulate as table bloat over time. A one-time GC script could scan `vault_docs` and delete rows whose `file_path` is not in the corresponding `__manifest__` doc's `files` map. Not urgent — no functional impact.
- `[OPEN]` **Prod relay URL 404** — `https://freesync-production.up.railway.app/health` returned `404 Application not found` on 2026-07-22. The Railway app appears removed or renamed. Prod may have moved or been retired. Verify current URL before assuming prod deploy target.

---

## Hard-Won Layout Rules (never revert)

- `[WONTFIX]` `border-left` for nav highlights — conflicts with Obsidian's inline `padding-inline-start`. Use `box-shadow: inset 3px 0 0 <color>` instead.
- `[WONTFIX]` Appending presence badges to outer `.nav-file-title` div — breaks Obsidian's flex layout. Always append to `.tree-item-inner`, and force `display:flex; flex:1` on it first.
- `[WONTFIX]` Using `yText.observe()` for remote change detection — fires on local changes too. Use `doc.on('update', (update, origin) => ...)` with `LOCAL_ORIGIN` check.
- `[WONTFIX]` Delete-all + insert-all sync strategy — produces garbage under concurrent editing. Always use minimal diff (`diff.ts`).
- `[WONTFIX]` `line-height: 16px` (= element height) on avatar circles — more reliable than `display:inline-flex; align-items:center` for vertically centering a single letter; Obsidian's inherited line-height breaks flexbox centering.
- `[WONTFIX]` `obsidian eval --vault <name>` does NOT target a specific vault window — it always targets the focused window. Use `scripts/dev-reload.py` which focuses via Windows EnumWindows API first.
