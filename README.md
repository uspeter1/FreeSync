# FreeSync

Real-time collaborative editing for [Obsidian](https://obsidian.md/) — "Google Docs for your vault." Two people (or two of your own devices) can open the same note and see each other's cursors, selections, and edits as they happen.

> **Status: pre-release, under active development.** APIs, schemas, and self-host instructions are subject to churn. Do not use with data you cannot afford to lose.

## What's here

| Package | What it does |
|---|---|
| [`packages/plugin`](packages/plugin) | Obsidian community plugin (TypeScript, esbuild). Implements sync via [Yjs](https://github.com/yjs/yjs), presence badges, live cursors, inline comments, share-vault UX. |
| [`packages/server`](packages/server) | Relay server (Node + Express + [y-websocket](https://github.com/yjs/y-websocket)). Terminates Yjs sync + awareness connections; validates JWTs against Supabase; persists Y.Doc state as BYTEA rows in `vault_docs`. |
| [`packages/web`](packages/web) | Web dashboard (Next.js 15 App Router). Lets users manage vaults, invite collaborators, and (soon) preview vault content in the browser. |
| [`packages/FreeSyncApp`](packages/FreeSyncApp) | Mobile app scaffold (Expo, React Native). Feature-complete for Phase 2 scope, awaiting rollout. |
| [`brain`](brain) | The design brain: Architecture, Decisions-Log, Known-Issues, Phase-Status, per-agent playbooks. Read this before making non-trivial changes. |

## How the pieces fit together

```
┌──────────────────────────────────────────┐
│  Obsidian plugin  ─┐          Web app    │
│  (multi-device)    │          (browser)  │
└────────────────────┼─────────────────────┘
                     │
              WebSocket + REST
                     │
              ┌──────▼──────┐
              │    Relay    │  ← this repo, packages/server
              │  (Node.js)  │
              └──────┬──────┘
                     │
              Auth + Postgres
                     │
              ┌──────▼──────┐
              │   Supabase  │  ← external, self-provisioned
              └─────────────┘
```

The plugin and web app each hold local Yjs docs; the relay merges updates from all connected clients and persists them so users can rejoin later. Supabase provides auth (JWT), the `vault_docs` / `vaults` / `vault_members` / `pending_invites` tables, and (in production) email delivery for invites.

## Self-hosting

**For a permanent personal setup** — Raspberry Pi, home server, cheap VPS, etc — see [**SELF_HOSTING.md**](SELF_HOSTING.md). It walks through Supabase schema + RLS + storage setup, running the relay as a systemd service, exposing it via Cloudflare Tunnel (free, no port-forwarding, no cert renewal), and building the plugin. Full cost floor is $0/mo on Supabase's free tier + your own hardware.

## Local development

You'll need Node 22+, a Supabase project (free tier is fine — see [SELF_HOSTING.md § Part 1](SELF_HOSTING.md#part-1--set-up-supabase) for the schema), and Obsidian.

```bash
# Relay (:3001)
cp packages/server/.env.example packages/server/.env
# Edit .env — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS
npm install
npm run dev --workspace=packages/server

# Web dashboard (:3002)  — in another shell
cp packages/web/.env.example packages/web/.env.local
# Edit — NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_RELAY_URL
npm run dev --workspace=packages/web

# Plugin — build once, or with --watch during active dev
cp packages/plugin/.env.example packages/plugin/.env
# Optionally set RELAY_URL / WEB_APP_URL to bake into the bundle
npm run build --workspace=packages/plugin
```

`main.js`, `manifest.json`, and `styles.css` land in `packages/plugin/`. Drop them into `<your-vault>/.obsidian/plugins/freesync/` and enable in Obsidian.

For a smoother multi-vault dev loop, set `FREESYNC_DEV_VAULTS` (colon-separated plugin dirs) and the build copies to all of them:

```bash
export FREESYNC_DEV_VAULTS=/path/to/vault1/.obsidian/plugins/freesync:/path/to/vault2/.obsidian/plugins/freesync
```

The plugin's **Advanced** settings panel exposes runtime overrides for Supabase URL, anon key, relay URL, and web-app URL — handy for switching a running plugin to a different backend without rebuilding.

## Design decisions and known issues

**Read [`brain/Decisions-Log.md`](brain/Decisions-Log.md) and [`brain/Known-Issues.md`](brain/Known-Issues.md) before touching sync, presence, or the relay's persistence layer.** Several past regressions caused real data loss; the fixes are load-bearing. Highlights:

- Relay persistence uses `setPersistence({ bindState, writeState })` — the "cross-restart" case is a real prior data-loss root cause. Never remove `bindState`.
- Cursor presence relies on a specific `box-shadow` + `awarenessCleaner` guard pattern (see [`CLAUDE.md`](CLAUDE.md)).
- Receiver-side deletes always go through `vault.trash`, never `vault.delete`. This is the last-resort recovery net.

## Roadmap

Phase status and priorities live in [`brain/Phase-Status.md`](brain/Phase-Status.md).

## License

Not yet declared. Treat as all-rights-reserved until a `LICENSE` file appears.

## Contributing

FreeSync is not currently accepting outside PRs — the API surface and schema are still churning. Watch this space.
