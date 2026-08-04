# Self-hosting FreeSync

End-to-end setup for running your own FreeSync instance permanently. Works on any Linux host: a home server, Raspberry Pi, cheap VPS, or a spare laptop that stays on. Cost floor is **$0** (Supabase free tier + your own hardware + Cloudflare Tunnel) up to **~$5/mo** if you rent a VPS.

> **Status: pre-release.** Schema and behavior still change occasionally. Don't put a vault you can't afford to lose behind a self-host that you can't back up.

---

## The 30-second picture

```
┌──────────────────────────────────────────────┐
│  Obsidian plugin  ─┐          Web dashboard  │
│  (many devices)    │          (browser)      │
└────────────────────┼─────────────────────────┘
                     │  wss:// + https://
                     ▼
             ┌──────────────┐
             │    Relay     │  ← Node.js, this repo, runs on YOUR host
             │  (port 3001) │
             └──────┬───────┘
                    │
        ┌───────────┼──────────────┐
        │           │              │
        ▼           ▼              ▼
     Supabase   Supabase        Supabase
      Auth      Postgres       Storage (binaries)
     (JWTs)    (metadata +    (Y-Doc snapshots
                Y-Doc rows)    live in Postgres)
```

Three pieces you own:
1. **Supabase project** (they host the DB + auth + storage; you own the data)
2. **Relay server** (Node.js — hosted anywhere you can run Node continuously)
3. **The plugin** (built once, sideloaded into Obsidian; picks up your URLs at build time)

The web dashboard is optional. It's convenient for inviting collaborators and browsing content in the browser, but sync between Obsidian devices doesn't need it.

---

## What you'll need

- A machine that can stay on — Raspberry Pi 3B+ or newer, an always-on desktop, a cheap VPS (Hetzner CX22 = €3.79/mo, Vultr $2.50/mo instance), etc. **~100 MB RAM per relay is plenty** for personal use.
- **Node.js 20+** on that machine (root `package.json` enforces `engines.node: ">=20"`)
- A **Supabase account** (free tier is fine — 500 MB database, 1 GB storage)
- A **Cloudflare account** (free — for the tunnel, so you get a stable HTTPS URL without touching your router)
- A domain name (**optional but recommended**, $8–15/yr from Namecheap/Porkbun/etc — makes the URL look like `freesync.yourdomain.com` instead of `<random-id>.cfargotunnel.com`)
- A machine to build the plugin (any dev box with Node 22+ — even the same host)

---

## Part 1 — Set up Supabase

### 1.1 Create the project

1. Sign up at [supabase.com](https://supabase.com/) → **New project**
2. Pick a strong DB password (store it somewhere; you won't need it often)
3. Choose the region closest to where your users live
4. Wait ~2 minutes for provisioning

### 1.2 Grab the keys

**Project Settings → API**:

| Key | Where it's used | Secret? |
|---|---|---|
| Project URL | Everywhere | No |
| `anon` public key | Plugin, web app | No (safe to embed in client code) |
| `service_role` key | Relay server only | **YES — never commit or ship to clients** |

### 1.3 Create the schema

**SQL Editor → New query** → paste and run:

```sql
-- ── Tables ────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#7c5cfc',
  tier          TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.vaults (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  open_invite BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.vault_members (
  vault_id  UUID REFERENCES public.vaults(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (vault_id, user_id)
);

CREATE TABLE public.vault_docs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id   UUID REFERENCES public.vaults(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  yjs_state  BYTEA,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vault_id, file_path)
);

CREATE TABLE public.pending_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id   UUID NOT NULL REFERENCES public.vaults(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vault_id, email)
);

-- ── Auto-create a profile row when a new auth user signs up ──────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  palette TEXT[] := ARRAY['#f472b6','#60a5fa','#4ade80','#fb923c','#a78bfa','#f59e0b','#34d399'];
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  INSERT INTO public.profiles (id, display_name, color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    palette[(user_count % 7) + 1]
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Auto-promote pending invites when the invitee signs up ───────────────
CREATE OR REPLACE FUNCTION public.on_invite_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR TG_OP = 'INSERT') THEN
    INSERT INTO public.vault_members (vault_id, user_id, status)
    SELECT pi.vault_id, NEW.id, 'invited'
    FROM public.pending_invites pi
    WHERE lower(pi.email) = lower(NEW.email)
    ON CONFLICT (vault_id, user_id) DO NOTHING;

    DELETE FROM public.pending_invites WHERE lower(email) = lower(NEW.email);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_confirmed
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.on_invite_confirmed();
```

### 1.4 Enable RLS + add policies

```sql
-- Enable RLS
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaults         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_docs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- vaults
CREATE POLICY "vaults_owner_all" ON public.vaults
  FOR ALL TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "vaults_member_select" ON public.vaults
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_members
      WHERE vault_id = id AND user_id = auth.uid() AND status = 'active'
    )
  );

-- vault_members
CREATE POLICY "vault_members_owner_all" ON public.vault_members
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vaults
      WHERE id = vault_id AND owner_id = auth.uid()
    )
  );
CREATE POLICY "vault_members_self_select" ON public.vault_members
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "vault_members_self_insert" ON public.vault_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- vault_docs (relay uses service_role and bypasses this; kept for direct DB reads)
CREATE POLICY "vault_docs_member_all" ON public.vault_docs
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_members
      WHERE vault_id = vault_docs.vault_id AND user_id = auth.uid() AND status = 'active'
    )
  );

-- pending_invites (owner-managed)
CREATE POLICY "pending_invites_owner_all" ON public.pending_invites
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.vaults WHERE id = vault_id AND owner_id = auth.uid())
  );
```

### 1.5 Create the Storage bucket for binaries

Images, PDFs and other non-text attachments live in **Supabase Storage**, not in `vault_docs`. Set it up:

1. **Storage → New bucket** → name `vault-assets` → **Public bucket: ON** → **Create**
   - *Public* lets browsers fetch attachments directly by signed URL without a round-trip through the relay.

2. Then in **SQL Editor**, run these policies (they gate uploads/updates/deletes to active vault members, using a SECURITY DEFINER helper — Supabase Storage's schema pre-check rejects cross-schema `EXISTS` subqueries inside RLS policies):

```sql
-- Helper: is this user an active member of the vault whose ID is <text>?
CREATE OR REPLACE FUNCTION public.is_active_vault_member(vault_id_text text, uid uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vault_members
    WHERE vault_id::text = vault_id_text
      AND user_id = uid
      AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_active_vault_member(text, uuid) TO anon, authenticated;

-- storage.buckets needs at least SELECT for authenticated clients, otherwise
-- every Storage op returns a generic "database schema is invalid" error.
CREATE POLICY "buckets_select_authenticated"
  ON storage.buckets FOR SELECT TO authenticated USING (true);

-- storage.objects: active members of the vault can write / update / delete
-- objects under <vaultId>/... in the vault-assets bucket.
CREATE POLICY "vault_assets_insert_active_members"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vault-assets'
    AND public.is_active_vault_member((storage.foldername(name))[1], auth.uid())
  );

CREATE POLICY "vault_assets_update_active_members"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vault-assets'
    AND public.is_active_vault_member((storage.foldername(name))[1], auth.uid())
  )
  WITH CHECK (
    bucket_id = 'vault-assets'
    AND public.is_active_vault_member((storage.foldername(name))[1], auth.uid())
  );

CREATE POLICY "vault_assets_delete_active_members"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'vault-assets'
    AND public.is_active_vault_member((storage.foldername(name))[1], auth.uid())
  );
```

### 1.6 Auth settings

**Authentication → Providers → Email**:
- Confirm email: **your call**. Off = users can sign in immediately after signup (fine for personal use, easier for testing). On = production behavior (users must click a link in an email — requires Supabase's SMTP or a configured SMTP provider).
- JWT expiry: **3600s** default is fine.

If you leave email confirmation off, users are auto-confirmed. If you turn it on, the `on_invite_confirmed` trigger fires when they eventually confirm.

---

## Part 2 — Run the relay server

The relay is a Node.js process that terminates WebSocket connections from clients and merges Yjs edits into a shared document, persisting to Supabase.

### 2.1 Install Node.js

**On Debian/Ubuntu/Raspberry Pi OS:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs git
node --version   # should be v20+
```

**On any other Linux distro** — install Node 20 (or newer) however you normally would (nvm, `apk add nodejs npm`, etc).

> **Raspberry Pi note:** Pi 3 and up work fine (arm64). Older Pis (armv6, e.g. Pi Zero W) — the relay will *technically* run but the Node ecosystem's arm64 assumption keeps getting harder to escape. Recommend Pi 3B+ / 4 / 5 / Zero 2W.

### 2.2 Get the code onto the host

```bash
cd /opt   # or wherever you keep services
sudo git clone https://github.com/uspeter1/freesync.git
sudo chown -R $USER:$USER freesync
cd freesync
npm install
```

> **Bandwidth-conscious?** Only the relay needs to run on the host. You can shallow-clone or copy just `packages/server/` + its `package.json` + a top-level `package.json` if you want, but the extra ~100 MB from a full clone is easier and future-proof.

### 2.3 Configure the relay

```bash
cp packages/server/.env.example packages/server/.env
$EDITOR packages/server/.env
```

Fill in:

```dotenv
# Where Supabase lives
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste from Supabase Settings → API>

# Web origins allowed to talk to the relay (CORS).
# Comma-separated. Include EVERY URL where the web app is hosted, plus
# localhost for local dev.
ALLOWED_ORIGINS=https://freesync-web.yourdomain.com,http://localhost:3002

# Port the relay binds to on the host. Default 3001.
PORT=3001
```

### 2.4 Test-run

```bash
npm run dev --workspace=packages/server
```

You should see:
```
[freesync] Relay server listening on port 3001
[freesync] Health: http://localhost:3001/health
```

Confirm from another shell:
```bash
curl http://localhost:3001/health
# {"status":"ok","ts":"..."}
```

If that works, Ctrl+C and set it up to run permanently.

### 2.5 Run as a systemd service

Create `/etc/systemd/system/freesync-relay.service`:

```ini
[Unit]
Description=FreeSync relay server
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/opt/freesync
ExecStart=/usr/bin/node --enable-source-maps packages/server/dist/index.js
# If you didn't compile, use the tsx dev path instead:
# ExecStart=/usr/bin/npx tsx packages/server/src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

For the `dist/` path to work, add a build step to `packages/server/package.json` if you want a compiled binary. Simpler for now: use the `tsx` line (already committed, works from `npm run dev`).

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now freesync-relay
sudo systemctl status freesync-relay
journalctl -u freesync-relay -f     # tail logs
```

The relay now auto-starts on boot and restarts on crash.

---

## Part 3 — Expose the relay to the internet

The plugin connects over WSS (WebSocket-over-TLS). You need a publicly reachable URL that terminates TLS. Two paths — Cloudflare Tunnel is dramatically easier.

### Option A — Cloudflare Tunnel (recommended)

**Pros:** No port-forwarding on your router, no cert renewal, free forever, works behind CGNAT/NAT.
**Cons:** Traffic goes through Cloudflare's edge (fine for a personal sync relay — latency added is ~20–50 ms).

**One-time setup:**

1. Sign in at [cloudflare.com](https://cloudflare.com), add your domain (**Websites → Add site**). Change the domain's nameservers to the two Cloudflare gives you. (If you don't have a domain, you can still use Tunnel — see the note at the end of this section.)

2. On your relay host:
```bash
# Install cloudflared (Debian/Ubuntu/Pi OS)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb   # use ...-amd64.deb on x86 hosts

# Log in — opens a browser link; approve on your Cloudflare account
cloudflared tunnel login

# Create the tunnel
cloudflared tunnel create freesync

# Route a subdomain to it
cloudflared tunnel route dns freesync freesync.yourdomain.com

# Config
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<'YAML'
tunnel: freesync
credentials-file: /home/YOUR_USER/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: freesync.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
YAML

# Test-run
cloudflared tunnel run freesync
```

Hit `https://freesync.yourdomain.com/health` — should return the same OK JSON as `curl localhost:3001/health`.

3. Install as a service:
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Your relay URL is now `wss://freesync.yourdomain.com/sync` and it survives reboots.

> **No domain?** Cloudflare Tunnel also supports "quick tunnels" that give you a random `<id>.trycloudflare.com` URL. **Those rotate on every restart** — not suitable for permanent use. If you want a stable URL without a custom domain, cheapest fix is a $8/yr `.xyz` at Porkbun or similar.

### Option B — Direct port-forward + Caddy + Let's Encrypt

If you don't want to route through Cloudflare, you can serve TLS yourself. You'll need:
- Port 80 and 443 forwarded on your router to the relay host
- A domain with an A record pointing at your public IP (or a dynamic DNS solution like DuckDNS)
- Caddy for automatic Let's Encrypt certs

`/etc/caddy/Caddyfile`:
```
freesync.yourdomain.com {
    reverse_proxy 127.0.0.1:3001
}
```

`sudo systemctl restart caddy`. Caddy handles cert acquisition and renewal automatically. This works but is more moving parts than the tunnel.

---

## Part 4 — Web dashboard (optional)

The dashboard is a Next.js app. Skip this section if you're happy managing invitations from inside the plugin.

### Option A — Deploy to Vercel (easiest)

1. Fork the repo (or push your own copy)
2. Import the project into Vercel
3. Set the **Root Directory** to `packages/web`
4. Environment variables (Vercel UI):
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key
   - `NEXT_PUBLIC_RELAY_URL` — `https://freesync.yourdomain.com` (no path, no `wss://` — the client turns it into wss for WebSockets internally)
5. Deploy. Vercel gives you a `*.vercel.app` URL or you can add a custom subdomain.
6. **Go back to the relay's `.env`** and add the web URL to `ALLOWED_ORIGINS`, then restart the relay:
   ```bash
   sudo systemctl restart freesync-relay
   ```

### Option B — Run on the same host as the relay

```bash
cd /opt/freesync
cp packages/web/.env.example packages/web/.env.local
# Same three env vars as above; NEXT_PUBLIC_RELAY_URL can point at localhost
# for co-hosted setups if you also proxy the dashboard through the same
# Cloudflare Tunnel (add another ingress rule with hostname web.yourdomain.com).

npm run build --workspace=packages/web
```

Then a systemd unit similar to the relay's, running `npm start --workspace=packages/web` on port 3002.

---

## Part 5 — Build and install the plugin

The plugin needs to know the relay URL and the web-app URL. These bake in at build time via env vars.

### 5.1 On any machine with Node 22+ (can be the same host, or your dev box):

```bash
git clone https://github.com/uspeter1/freesync.git
cd freesync
npm install

cp packages/plugin/.env.example packages/plugin/.env
$EDITOR packages/plugin/.env
```

`packages/plugin/.env`:
```dotenv
RELAY_URL=wss://freesync.yourdomain.com/sync
WEB_APP_URL=https://freesync-web.yourdomain.com   # or your Vercel URL, or leave default
```

```bash
npm run build --workspace=packages/plugin
```

This produces `packages/plugin/main.js`, `manifest.json`, `styles.css`.

### 5.2 Install into Obsidian

**Option A — one vault, manual copy:**
```
<your-vault>/.obsidian/plugins/freesync/
  main.js
  manifest.json
  styles.css
```
Then in Obsidian: **Settings → Community plugins → Enable community plugins → Enable FreeSync**.

**Option B — multiple devices, auto-update via BRAT:**
Publish a GitHub release with the three files as assets. On each device:
1. Install **Obsidian42 - BRAT** from community plugins
2. **BRAT → Add beta plugin** → `<your-github-user>/freesync` (or wherever you forked to)
3. Enable FreeSync in community plugins

BRAT will auto-check for updates when you bump the manifest version and publish a new release.

### 5.3 Sign up + first sync

Anyone new needs a Supabase account. Two paths:
- **Sign up in the web dashboard** if you deployed it (`/auth/signup`)
- **Sign up via the plugin's onboarding** — the plugin's setup screen links out to the web app

Once signed in inside Obsidian:
- Plugin auto-detects existing vault content and offers to create a matching FreeSync vault, OR pick an existing one
- Repeat on any additional device with the same account → files start syncing

---

## Part 6 — End-to-end sanity check

1. Sign in on **two devices** with the same account.
2. Both should show as connected in **FreeSync sidebar** (users icon in ribbon).
3. Open the same note in both. Type on one — text should appear on the other within a second, with a brief purple pulse.
4. Move your cursor on one — should show as a colored caret + name label on the other.
5. Paste an image on one — should upload, sync, and render inline on the other.

If anything above breaks, jump to **Troubleshooting** below.

---

## Tips

- **Back up your Supabase database periodically.** Supabase's free tier keeps daily backups for 7 days. If you want deeper history, set up a `pg_dump` cron on your host that pipes to somewhere you own.
- **Watch relay memory.** `journalctl -u freesync-relay -f` and `ps` if things get sluggish. Each open vault keeps its Y-Docs in RAM. Restarting the relay is safe — clients reconnect automatically.
- **Rotate the invite code** on the web dashboard (or a `POST /vaults/:id/rotate-invite-code` API call) if a code leaks.
- **Test with a throwaway account** before inviting real collaborators. Use Gmail's `+alias` trick: `you+freesync-test@gmail.com` all land in `you@gmail.com` but Supabase treats them as separate users.
- **Keep the plugin build reproducible.** Commit `packages/plugin/.env.example`, not `.env` — it's already gitignored. If you fork, add your own `.env` to your forked repo's build server (or bake URLs in via CI env vars).

---

## Troubleshooting

**Plugin says "connected" but nothing syncs**
- Check the relay is reachable: `curl https://freesync.yourdomain.com/health` from your device's network. If not, the tunnel / port-forward is broken.
- Watch the relay logs while opening a note: `sudo journalctl -u freesync-relay -f`. You should see WebSocket connections show up.

**"Failed to fetch" in the browser (web dashboard)**
- The web tunnel's origin isn't in `ALLOWED_ORIGINS`. Add it to `packages/server/.env` and restart the relay. Watch the relay log — a rejected CORS request logs `[error] CORS: origin ... not allowed`.

**Images fail to upload with "The database schema is invalid or incompatible"**
- Missing `SELECT` policy on `storage.buckets`. Run the SQL in **Part 1.5** again.

**Images fail to upload with "new row violates row-level security policy"**
- Missing / incorrect INSERT policy on `storage.objects` — the helper-function form in **Part 1.5** is required (Supabase Storage's schema pre-check rejects cross-schema subqueries in RLS bodies).
- OR you're signed in as a user who isn't an **active** member of the vault you're uploading to (e.g. still `invited`).

**Storage uploads worked at first, then start returning 401 an hour later**
- Old bug we already fixed on the plugin side (JWT expired, no auto-refresh). Make sure your plugin build is >= v0.2.1. If you built older, rebuild.

**Cursor appears in the wrong place after a lot of pasted text**
- Not currently a known bug. Please open an issue with a repro.

**Relay OOMs on a Raspberry Pi**
- Should not happen for personal use, but if you're syncing large vaults (hundreds of MB), consider `--max-old-space-size=512` in the systemd `ExecStart` (or move to a beefier host).

**Cloudflare Tunnel URL rotates on every restart**
- You're using the ephemeral quick-tunnel form (`cloudflared tunnel --url http://localhost:3001`). Switch to the **named** tunnel setup in Part 3.

---

## What comes next

- Real DB migrations under `supabase/migrations/` (currently the SQL is inline in this file)
- Docker image for the relay so you can `docker run` instead of the manual install
- A one-shot bootstrap script that runs Parts 1–3 end-to-end

If you get stuck at any step, open an issue with the section number and what you see. The guide will get better as edge cases turn up.
