# Phase Status

> See also: [[Architecture]], [[Decisions-Log]], [[Known-Issues]], [[Comments-Plan]]

## Current Phase
**P1 Features — Share link + invite by email is next**
**Status:** All P0 features done. Inline comments, binary sync, last-edited-by, version history (basic), and multi-device presence are complete. Railway relay deployed and live. Next: share link + invite-by-email UI (invite code schema exists).
**Date updated:** 2026-05-13

## Phase History

| Phase | Name | Status | Agent | Notes |
|-------|------|--------|-------|-------|
| 0 | Bootstrap | ✅ Complete | Orchestrator | Brain vault, monorepo skeleton, GitHub infra |
| 1a | Backend | ✅ Complete | Backend Engineer | Supabase schema, relay server |
| 1b | Plugin | ✅ Complete | Plugin Engineer | Sync, presence, cursors, sidebar, file rename |
| — | Inline Comments | ✅ Complete | Plugin Engineer | CM6 highlights, panel, replies, real-time |
| — | Binary File Sync | ✅ Complete | Plugin Engineer | PNG/PDF via Supabase Storage; manifest carries storageKey + binaryVersion |
| — | Last Edited By + Version History | ✅ Complete | Plugin Engineer | Status bar "Name · Xm ago"; 20-snapshot modal |
| — | Railway Deployment | ✅ Complete | Plugin Engineer | `wss://freesync-production.up.railway.app`; auto-deploys from branch |
| 2 | Mobile | 🔲 Not started | Mobile Frontend Engineer | Expo app |
| 3 | Web | 🔲 Not started | Web Frontend Engineer | Next.js dashboard |
| 4 | Production | 🔲 Not started | Backend + Orchestrator | Hetzner, Docker, payments |

## What Works Right Now

### Infrastructure
- **Relay:** Live on Railway — `wss://freesync-production.up.railway.app`; health: `https://freesync-production.up.railway.app/health`; auto-deploys from `agent/plugin-phase1`
- Supabase: 4 tables (`profiles`, `vaults`, `vault_members`, `vault_docs`), RLS, `on_auth_user_created` trigger
- GitHub repo: `https://github.com/uspeter1/freesync`, branch `agent/plugin-phase1`
- **Peter's live account:** `peter@mattjones.org`, vaultId `101ccbe9-e0ff-4255-bd8f-b27f495f9840`

### Plugin (Phase 1b+ — Delivered)
- **Real-time co-editing** — Yjs CRDT + y-websocket, minimal diff, LOCAL_ORIGIN echo prevention
- **Live cursors** — Google Docs-style flag cursor (colored line + flag head + hover label); typing state (`updatedAt`) clears after 3s inactivity
- **Presence in file explorer** — colored initials badges + `inset 3px 0 0 <color>` box-shadow bar on `.tree-item-inner`; badges cleared and re-rendered on awareness change
- **Multi-device presence** — same user on two devices shows as two indicators by design (awareness keyed by random `clientID` per connection, not userId)
- **Sidebar panel** (`sidebar.ts`) — "FreeSync Live" right-leaf view showing all connected users, active file, "(you)" label for self
- **File create / rename / delete sync** — atomic rename via `renamedFrom` marker; uses `fileManager.renameFile()` to keep workspace leaves open
- **Binary file sync** — PNG/PDF/media via Supabase Storage `vault-assets`; manifest Y.Map carries `{ binary, storageKey, binaryVersion }`
- **Inline comments** — CM6 yellow highlights, floating "+" button, composer, right-panel cards with vertical alignment, replies, resolve; stored in per-file Y.Doc
- **Last edited by** — manifest Y.Map `lastEditedBy` + `lastEditedAt`; status bar "Name · Xm ago"; click opens version history modal
- **Version history** — per-file Yjs array, up to 20 snapshots (one per 5 min); viewable via status bar modal

### Test Infrastructure
- Two vaults: `FreeSyncUser1` (User1: `user1@freesync.test`) and `FreeSyncUser2` (User2: `user2@freesync.test`)
- Shared vaultId: `e49ed7f7-6c8a-4329-b8e9-1bfaea4be449`
- `scripts/dev-reload.py` — focuses each Obsidian window via Windows EnumWindows API then runs `obsidian eval` to reload plugin; no manual window-clicking needed
- `scripts/test-sync.sh` — uses direct filesystem writes to bypass `obsidian eval` vault-targeting limitation

## Roadmap (Updated Priority Order)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 | Real-time co-editing | ✅ Done |
| P0 | Live cursors (flag style) | ✅ Done |
| P0 | Presence in file explorer | ✅ Done |
| P0 | File create / rename / delete sync | ✅ Done |
| P0 | Binary file sync | ✅ Done |
| P0 | Inline comments | ✅ Done |
| P1 | Last edited by on files | ✅ Done |
| P1 | Version history (basic) | ✅ Done (basic) |
| P1 | Multi-device presence | ✅ Done (by design) |
| P1 | Self-hosted relay (Railway) | ✅ Done |
| **P1** | **Share link + invite by email** | 🔲 **Next** — invite code in schema; needs plugin UI |
| P1 | Comment notifications | 🔲 Planned |
| P2 | @mentions in comments | 🔲 Planned |
| P2 | Suggesting mode (track changes) | 🔲 Planned |
| P2 | Vault-level access management UI | 🔲 Planned |

## Active Blockers
None.

## Key Invariants (never violate)
1. Room path: `sync/${vaultId}/${filePath}` — plugin settings `relayUrl` is `wss://freesync-production.up.railway.app` for live; `ws://localhost:3001` for dev
2. Manifest room always connected: `sync/${vaultId}/__manifest__`
3. `LOCAL_ORIGIN = 'local'` tag on all local Yjs mutations — remote handlers skip it
4. Supabase `persistSession: false, autoRefreshToken: false` — Electron vaults share localStorage origin; always `signInWithPassword` on connect, never `getSession()`
5. `fileManager.renameFile()` not `vault.rename()` — keeps workspace leaves open during rename
6. `box-shadow: inset 3px 0 0 <color>` not `border-left` for nav highlights — see CLAUDE.md "Cursor Presence — Do Not Break"
7. `clearBadges()` must reset `inner.style.boxShadow = ''` — see CLAUDE.md checklist
8. Badges go inside `.tree-item-inner`, force it to `display:flex; flex:1` first
9. Minimal diff — never replace entire yText
10. Wait ~800ms after provider sync before seeding local content into empty doc
11. esbuild copies plugin to BOTH test vaults on every build
12. Never call `getBoundingClientRect()` inside CM6 `update()` — forces synchronous reflow, breaks cursor decorations
