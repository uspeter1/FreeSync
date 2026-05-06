# Architecture

## System Overview

FreeSync is "The Google Docs for Obsidian" — real-time collaborative sync for Obsidian vaults.

```
┌──────────────────────────────────────────────────────┐
│                      Clients                         │
│                                                      │
│  Obsidian Plugin           Mobile App (Expo)         │
│  ┌──────────────┐          ┌─────────────┐           │
│  │ sync.ts      │          │ VaultList   │           │
│  │ presence.ts  │          │ VaultShare  │           │
│  │ main.ts      │          │ SignIn/Up   │           │
│  │ diff.ts      │          └──────┬──────┘           │
│  └──────┬───────┘                 │ Supabase JS      │
│         │ WebSocket               │ REST             │
└─────────┼─────────────────────────┼──────────────────┘
          │                         │
          ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│   Relay Server      │   │   Supabase           │
│   Node.js :3001     │◄──│                     │
│                     │   │  Auth (JWT)          │
│  /sync/:vaultId     │   │  Postgres + RLS      │
│  y-websocket        │   │  Storage (binaries)  │
│  auth gate          │   └─────────────────────┘
│  Yjs persistence    │
└─────────────────────┘
```

## Presence Architecture

```
Presence (Yjs Awareness) flow:
  All clients always connect to: ${vaultId}/__manifest__
  This carries global presence — all vault members visible regardless of which file
  Per-file rooms: ${vaultId}/${encodeURIComponent(filePath)} — content sync + cursors

Badge rendering:
  .tree-item-inner → append badge span (box-shadow: inset 3px 0 0 <color>)
  Avatar circles: color-coded initials, float right of filename
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Auth + Database | Supabase (Auth, Postgres, RLS) |
| CRDT | Yjs + y-websocket |
| Relay server | Node.js, Express, TypeScript |
| Mobile | React Native, Expo, expo-router |
| Plugin | TypeScript, Obsidian API, esbuild |
| Web dashboard | Next.js (Phase 3) |
| Payments | Stripe (web) + RevenueCat (mobile) — Phase 4 |
| Hosting | Hetzner VPS (Phase 4) |

## Plugin Architecture

```
packages/plugin/
├── main.ts           # Plugin lifecycle, settings, auth, provider management
├── sync.ts           # Yjs doc management, y-websocket provider, file watching
├── presence.ts       # Awareness state, badge rendering, active user panel
├── diff.ts           # Minimal diff algorithm (common prefix/suffix)
├── esbuild.config.mjs # Build + copy to FreeSyncUser1 and FreeSyncUser2
└── manifest.json     # id: "freesync", minAppVersion: "1.0.0"
```

## Relay Architecture

```
packages/server/
├── src/
│   ├── index.ts       # Express app, WebSocket upgrade, health check
│   ├── auth.ts        # Supabase JWT verification middleware
│   ├── relay.ts       # y-websocket room management
│   └── persistence.ts # vault_docs upsert (yjs_state BYTEA)
└── package.json
```

## Key Invariants

See Phase-Status.md for the 10 non-negotiable architectural invariants.

## Environment Variables

### Relay Server (.env)
```
SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
PORT=3001
```

### Plugin (stored in Obsidian plugin settings, not .env)
```
SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
SUPABASE_ANON_KEY=<anon_key>
RELAY_URL=ws://localhost:3001/sync
```

### Mobile App (.env)
```
EXPO_PUBLIC_SUPABASE_URL=https://awgcorggtvfcnmjdcljb.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
EXPO_PUBLIC_RELAY_URL=ws://localhost:3001/sync
```
