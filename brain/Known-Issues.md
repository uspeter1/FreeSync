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

---

## Hard-Won Layout Rules (never revert)

- `[WONTFIX]` `border-left` for nav highlights — conflicts with Obsidian's inline `padding-inline-start`. Use `box-shadow: inset 3px 0 0 <color>` instead.
- `[WONTFIX]` Appending presence badges to outer `.nav-file-title` div — breaks Obsidian's flex layout. Always append to `.tree-item-inner`, and force `display:flex; flex:1` on it first.
- `[WONTFIX]` Using `yText.observe()` for remote change detection — fires on local changes too. Use `doc.on('update', (update, origin) => ...)` with `LOCAL_ORIGIN` check.
- `[WONTFIX]` Delete-all + insert-all sync strategy — produces garbage under concurrent editing. Always use minimal diff (`diff.ts`).
- `[WONTFIX]` `line-height: 16px` (= element height) on avatar circles — more reliable than `display:inline-flex; align-items:center` for vertically centering a single letter; Obsidian's inherited line-height breaks flexbox centering.
- `[WONTFIX]` `obsidian eval --vault <name>` does NOT target a specific vault window — it always targets the focused window. Use `scripts/dev-reload.py` which focuses via Windows EnumWindows API first.
