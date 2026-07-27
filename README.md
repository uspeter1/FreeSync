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

## Getting started (self-host / development)

You'll need Node 22+, a Supabase project (free tier is fine), and Obsidian installed locally.

### 1. Supabase

Create a project at [supabase.com](https://supabase.com/). Grab from **Project Settings → API**:
- Project URL (`https://<project-ref>.supabase.co`)
- `anon` public key
- `service_role` key (never ship this to a client)

Schema migrations live in the `brain/` design docs; a proper `supabase/migrations/` folder is on the roadmap. For now:
- `profiles`, `vaults`, `vault_members`, `vault_docs` are created as described in `brain/Architecture.md`.
- The `open_invite` column and `pending_invites` table with its `on_invite_confirmed` trigger are documented in `brain/Known-Issues.md`.

### 2. Relay (`packages/server`)

```bash
cp packages/server/.env.example packages/server/.env
# Edit .env — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ALLOWED_ORIGINS
# (comma-separated list of web origins, e.g. http://localhost:3002)

npm install
npm run dev --workspace=packages/server
```

Relay listens on `:3001` by default. Health check at `http://localhost:3001/health`.

### 3. Web dashboard (`packages/web`)

```bash
cp packages/web/.env.example packages/web/.env.local
# Edit — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# and NEXT_PUBLIC_RELAY_URL (defaults to http://localhost:3001)

npm run dev --workspace=packages/web
```

Open [http://localhost:3002](http://localhost:3002). Sign up, then land on `/dashboard`.

### 4. Obsidian plugin (`packages/plugin`)

```bash
# Build once, or use --watch during development
npm run build --workspace=packages/plugin
```

`main.js`, `manifest.json`, and `styles.css` land next to the config. Drop them into `<your-vault>/.obsidian/plugins/freesync/` and enable the plugin from Obsidian's Community plugins panel.

For a smoother dev loop, set `FREESYNC_DEV_VAULTS` to a colon-separated list of plugin dirs and the build will copy into all of them:

```bash
export FREESYNC_DEV_VAULTS=/path/to/vault1/.obsidian/plugins/freesync:/path/to/vault2/.obsidian/plugins/freesync
```

The plugin's Advanced settings panel exposes overrides for Supabase URL, anon key, relay URL, and the web-app URL used for sign-up / dashboard links. The web-app URL can also be baked in at build time:

```bash
WEB_APP_URL=https://your-web-domain.example \
  npm run build --workspace=packages/plugin
```

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
