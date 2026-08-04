<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
  <img alt="FreeSync — Google Docs for Obsidian" src=".github/assets/banner-light.svg" width="700">
</picture>

# FreeSync

Real-time collaborative editing for [Obsidian](https://obsidian.md/) — two people (or two of your own devices) can open the same note and see each other's cursors, selections, and edits as they happen. Runs entirely on infrastructure you own: a Supabase project, a relay server on a Raspberry Pi or cheap VPS, and (optionally) a web dashboard.

> **Status: pre-release, under active development.** APIs, schemas, and self-host instructions are subject to churn. Do not use with data you cannot afford to lose.

---

## What you get

- **Live cursors and selections.** Every collaborator's caret appears in your editor with their name and color, updated in real time. Same-account cross-device shows as `You`.
- **Presence in the file explorer.** Colored bar + avatar next to the note each collaborator has open.
- **Inline comments.** CM6-anchored highlights with a right-panel thread view; comment on any selection.
- **Live-typed remote inserts.** A brief accent-color pulse over ranges that arrived from collaborators — batched network updates feel like typing, not "a paragraph appearing."
- **Canvas support.** Live mouse cursors on Obsidian's native canvas view, plus a schema-aware CRDT so two people dragging different nodes never corrupt the JSON.
- **Attachments sync.** Pasted images, PDFs, and other binaries land in Supabase Storage and appear on every device (including in the web preview, with `![[wikilink]]` embeds resolved).
- **Web dashboard.** Browse vault contents, manage members, accept invitations without opening Obsidian.

## Install (as a user)

There's **no public hosted relay yet** — every user runs their own. The 30-second summary of the setup:

1. **[Self-host a relay](SELF_HOSTING.md)** — free on hardware you already have (Pi, home server, spare box). Full walkthrough with SQL + systemd + Cloudflare Tunnel in `SELF_HOSTING.md`.
2. **Install the plugin via BRAT** — in Obsidian, install the community plugin *Obsidian42 - BRAT*, then **BRAT → Add beta plugin → `uspeter1/freesync`**.
3. In FreeSync's **Advanced settings**, set the relay URL to your own (`wss://freesync.yourdomain.com/sync`).
4. Sign in with a Supabase account, pick or create a vault, and edit the same note on a second device.

If you get stuck, [SELF_HOSTING.md § Troubleshooting](SELF_HOSTING.md#troubleshooting) maps the most common errors to their fixes.

## How the pieces fit together

```
   Obsidian plugin  ─┐          Web dashboard
   (many devices)    │          (browser)
                     │
              WebSocket + REST
                     │
              ┌──────▼──────┐
              │    Relay    │  ← self-hosted, packages/server
              │  (Node.js)  │
              └──────┬──────┘
                     │
                Auth · Postgres · Storage
                     │
              ┌──────▼──────┐
              │   Supabase  │  ← self-provisioned; free tier fine
              └─────────────┘
```

Plugin and web app each hold local [Yjs](https://github.com/yjs/yjs) docs; the relay merges updates from every connected client and persists them so users can rejoin later. Supabase provides auth (JWT), the metadata + Y-Doc tables, Storage for binaries, and email delivery for invites.

## Repo layout

| Package | What it does |
|---|---|
| [`packages/plugin`](packages/plugin) | Obsidian community plugin. TypeScript, esbuild. Sync via [y-websocket](https://github.com/yjs/y-websocket), presence badges, live cursors, inline comments, canvas cursors, share-vault UX. |
| [`packages/server`](packages/server) | Relay server. Node + Express + y-websocket. Terminates Yjs sync + awareness, validates JWTs against Supabase, persists Y-Doc state as BYTEA rows in `vault_docs`, generates signed Storage URLs. |
| [`packages/web`](packages/web) | Web dashboard. Next.js 15 App Router. Vault management, invitation flow, activity feed, profile settings, in-browser file browser + markdown preview. |
| [`packages/FreeSyncApp`](packages/FreeSyncApp) | Mobile app scaffold (Expo, React Native). Not shipped — feature-complete for its phase but no store rollout yet. |
| [`brain`](brain) | The design brain: Architecture, Decisions-Log, Known-Issues, Phase-Status, per-agent playbooks. Read before touching sync, presence, or persistence. |

## Local development

For a permanent personal setup, use [SELF_HOSTING.md](SELF_HOSTING.md). For hacking on the code:

```bash
# You'll need Node 20+ (root package.json enforces via engines) and a Supabase
# project. Schema SQL is in SELF_HOSTING.md § Part 1.

# Relay (:3001)
cp packages/server/.env.example packages/server/.env
# Fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGINS
npm install
npm run dev --workspace=packages/server

# Web dashboard (:3002)  — in another shell
cp packages/web/.env.example packages/web/.env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_RELAY_URL
npm run dev --workspace=packages/web

# Plugin — one-off build, or --watch during active dev
cp packages/plugin/.env.example packages/plugin/.env
# Optionally set RELAY_URL / WEB_APP_URL to bake into the bundle
npm run build --workspace=packages/plugin
```

The plugin's built `main.js`, `manifest.json`, and `styles.css` land in `packages/plugin/`. Drop them into `<your-vault>/.obsidian/plugins/freesync/` and enable in Obsidian.

For a smoother multi-vault dev loop, set `FREESYNC_DEV_VAULTS` (colon-separated plugin dirs) and the build copies to all of them:

```bash
export FREESYNC_DEV_VAULTS=/path/to/vault1/.obsidian/plugins/freesync:/path/to/vault2/.obsidian/plugins/freesync
```

The plugin's **Advanced** settings panel exposes runtime overrides for Supabase URL, anon key, relay URL, and web-app URL — useful for repointing a running plugin at a different backend without a rebuild.

## Design decisions and known issues

**Read [`brain/Decisions-Log.md`](brain/Decisions-Log.md) and [`brain/Known-Issues.md`](brain/Known-Issues.md) before touching sync, presence, or the relay's persistence layer.** Several past regressions caused real data loss; the fixes are load-bearing. Highlights:

- Relay persistence uses `setPersistence({ bindState, writeState })`. The "cross-restart" case is a real prior data-loss root cause — never remove `bindState`.
- The Supabase client is created with `{ persistSession: false, autoRefreshToken: true }`. `persistSession: false` prevents Electron vault windows from sharing sessions via localStorage; `autoRefreshToken: true` keeps the JWT alive past 1 hour so Storage uploads don't silently 401.
- Cursor presence relies on specific CSS (`box-shadow` not `border-left`) and a CM6 `awarenessCleaner` guard pattern. See [`CLAUDE.md`](CLAUDE.md).
- Receiver-side deletes always go through `vault.trash`, never `vault.delete` — the last-resort recovery net.
- Storage upload path uses direct `fetch`, not `supabase-js`'s Storage client, and puts `upsert=true` in the query string rather than the `x-upsert` header. Both worked around real bugs (see [SELF_HOSTING.md § Troubleshooting](SELF_HOSTING.md#troubleshooting)).

## Roadmap

Phase status and priorities live in [`brain/Phase-Status.md`](brain/Phase-Status.md). Near-term focus:

- Hosted relay for people who don't want to self-host
- Publish to Obsidian's community plugin directory
- Mobile app rollout
- `supabase/migrations/` folder so schema deltas ship with the repo

## License

Not yet declared. Treat as **all-rights-reserved** until a `LICENSE` file appears.

## Contributing

FreeSync is not currently accepting outside PRs — the API surface and schema are still churning. Issues and reproductions are welcome (there are templates under `.github/ISSUE_TEMPLATE/`).
