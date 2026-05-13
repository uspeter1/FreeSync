# Architecture

> See also: [[Phase-Status]], [[API-Reference]], [[Decisions-Log]]

## System Overview

FreeSync is "The Google Docs for Obsidian" — real-time collaborative sync for Obsidian vaults.

```
┌──────────────────────────────────────────────────────┐
│                      Clients                         │
│                                                      │
│  Obsidian Plugin           Mobile App (Expo)         │
│  ┌──────────────┐          ┌─────────────┐           │
│  │ main.ts      │          │ VaultList   │           │
│  │ sync.ts      │          │ VaultShare  │           │
│  │ presence.ts  │          │ SignIn/Up   │           │
│  │ cursors.ts   │          └──────┬──────┘           │
│  │ sidebar.ts   │                 │ Supabase JS      │
│  │ comments.ts  │ (next)          │ REST             │
│  │ diff.ts      │          └──────────────────────── │
│  └──────┬───────┘
│         │ WebSocket (y-websocket)
└─────────┼──────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐   ┌─────────────────────┐
│   Relay Server      │   │   Supabase           │
│   Node.js :3001     │◄──│                     │
│                     │   │  Auth (JWT)          │
│  WS /sync/:path     │   │  Postgres + RLS      │
│  y-websocket        │   │  vault_docs (BYTEA)  │
│  auth gate          │   └─────────────────────┘
│  Yjs persistence    │
└─────────────────────┘
```

## Room Naming Convention

All y-websocket connections use `baseUrl = ws://localhost:3001` and a room path:

| Room | Path | Purpose |
|------|------|---------|
| Manifest | `sync/${vaultId}/__manifest__` | Always connected; global presence + file tree Y.Map |
| Per-file | `sync/${vaultId}/${filePath}` | Content (yText) + cursors + comments (Y.Map) |

The relay strips `sync/` and uses the remainder as the Yjs doc name. See [[API-Reference]] for connection details.

## Presence Architecture

```
Awareness (on __manifest__ room):
  Every client publishes:
    user:       { id, display_name, color, initials }
    activeFile: string | null          ← updated by file-open events + rename handler
    cursor:     { head, anchor, updatedAt }  ← published by CM6 publishCursorExtension

Badge rendering (presence.ts):
  On awareness 'change' → scan all client states → build fileUsers map
  For each file with users: query .nav-file-title DOM nodes
  Inject badge spans inside .tree-item-inner (force display:flex; flex:1)
  Clear and re-render on every change

Cursor rendering (cursors.ts):
  CM6 ViewPlugin: remoteCursorsExtension(awarenessRef)
  On awareness 'change' → dispatch StateEffect → rebuild DecorationSet
  Filters by activeFile === current editor file path
  Renders: CursorWidget (flag head + 2px line + hover label)
  isTyping = cursor.updatedAt > 0 && (now - updatedAt) < 3000

AwarenessRef pattern:
  { awareness: Awareness | null, localClientId: number }
  Registered at onload() (awareness = null), populated after startSync()
  CM6 extensions poll every 500ms until awareness is set, then subscribe
```

## Plugin File Map

```
packages/plugin/src/
├── main.ts          Plugin lifecycle, Supabase auth, startSync/stopSync,
│                    registers all CM6 extensions + sidebar view
├── sync.ts          SyncManager: y-websocket providers per file, manifest
│                    room, vault event watchers (create/modify/delete/rename)
│                    File entry type: { exists: boolean; renamedFrom?: string }
├── presence.ts      PresenceManager: reads awareness, renders file explorer
│                    badges, tracks badgeData for clean teardown
├── cursors.ts       CM6 extensions: remoteCursorsExtension (renders remote
│                    cursors as flag decorations) + publishCursorExtension
│                    (publishes local cursor + typing state to awareness)
├── sidebar.ts       FreeSyncSidebarView (ItemView): "FreeSync Live" panel
│                    showing all connected users + active file per user
├── diff.ts          minimalDiff(old, new) → { index, deleteCount, insertText }
│                    Common prefix/suffix algorithm — never replaces whole doc
└── comments.ts      (Next) CM6 Mark decorations for comment ranges + floating
                     "add comment" button on selection
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Auth + Database | Supabase (Auth, Postgres, RLS) |
| CRDT | Yjs + y-websocket |
| Relay server | Node.js, Express, TypeScript |
| Mobile | React Native 0.74, Expo, expo-router |
| Plugin | TypeScript, Obsidian API, CM6, esbuild |
| Web dashboard | Next.js (Phase 3) |
| Payments | Stripe (web) + RevenueCat (mobile) — Phase 4 |
| Hosting | Hetzner VPS (Phase 4) |

## Relay Architecture

```
packages/server/src/
├── index.ts       Express app, WebSocket upgrade handler, /health
│                  Room path format: /sync/<vaultId>/<room>
│                  Rejects connections without 3-segment path (404)
├── auth.ts        Supabase JWT verification, vault membership check
├── relay.ts       y-websocket room management, doc lifecycle
└── persistence.ts vault_docs upsert on Yjs update (yjs_state BYTEA)
```

## Critical Bugs Fixed (Phase 1b) — see [[Decisions-Log]]

- **Electron localStorage sharing** — all Obsidian vault windows share the same origin, causing Supabase session bleed. Fixed: `persistSession: false, autoRefreshToken: false`; always `signInWithPassword`.
- **AwarenessRef subscription race** — CM6 ViewPlugin constructor runs before `startSync()`. The interval retry used `this.unsub` as a "connected" check, but `this.unsub` was set to the clearInterval wrapper before awareness connected, so `tryConnect()` always bailed early. Fixed: separate `awarenessCleaner` variable.
- **file-open null during rename** — Obsidian emits `file-open null` briefly when a leaf transitions during rename, clearing presence. Fixed: 300ms debounce on null events in `onFileOpen`.
- **Rename vs delete confusion** — manifest map observer saw 'delete' for old path before 'add' for new path, deleting the file. Fixed: two-pass processing: first pass collects `renamedFrom` paths, second pass skips their deletes.

## Environment Variables

### Relay Server (packages/server/.env)
```
SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
PORT=3001
```

### Plugin (Obsidian settings UI — not .env)
```
supabaseUrl:    https://awgcorggtvfcnmjdcljb.supabase.co
supabaseAnonKey: <anon_key>
relayUrl:       ws://localhost:3001/sync
```

### Mobile App (packages/FreeSyncApp/.env)
```
EXPO_PUBLIC_SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
EXPO_PUBLIC_RELAY_URL=ws://localhost:3001/sync
```
