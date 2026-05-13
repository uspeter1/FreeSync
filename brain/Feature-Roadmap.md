# Feature Roadmap

> See also: [[Phase-Status]], [[Comments-Plan]], [[Decisions-Log]]

This document tracks every feature we want to build, grouped by inspiration and priority. Update it as features ship or priorities shift.

---

## Google Docs Parity Features

These are the core "Google Docs for Obsidian" features. P0 is MVP-critical, P1 is launch-quality, P2 is post-launch.

### P0 — MVP (all complete ✅)

| Feature | Status | Notes |
|---------|--------|-------|
| Real-time co-editing | ✅ Done | Yjs CRDT, minimal diff |
| Live cursors with names | ✅ Done | Google Docs-style flag cursor, typing state |
| Presence in file explorer | ✅ Done | Colored avatar badges + inset box-shadow bar, sidebar panel |
| File create / rename / delete sync | ✅ Done | Atomic rename via Y.Map renamedFrom marker |
| Binary file sync | ✅ Done | PNG/PDF/media routed via Supabase Storage; manifest carries `{ binary, storageKey, binaryVersion }` |
| Inline comments | ✅ Done | CM6 yellow highlight + right-panel cards + vertical alignment; stored in per-file Yjs doc |

### P1 — Launch Quality

| Feature | Status | Notes |
|---------|--------|-------|
| Last edited by on files | ✅ Done | Manifest Y.Map carries `lastEditedBy` + `lastEditedAt`; status bar shows "Name · Xm ago"; click opens version history modal |
| Version history / snapshots | ✅ Done (basic) | Per-file Yjs array stores up to 20 snapshots (one per 5 min); viewable via status bar click modal |
| Share link + invite by email | 🔲 Planned | Invite code already exists in schema; needs email infra (Supabase email or Resend) and share UI in plugin |
| Comment notifications | 🔲 Planned | Notify user when someone replies to their comment or @mentions them |
| Presence on mobile | 🔲 Phase 2 | Awareness state already designed; mobile app needs to publish it |

### P2 — Post-Launch Polish

| Feature | Status | Notes |
|---------|--------|-------|
| @mentions in comments | 🔲 Planned | Tag `@username` in comment text; triggers notification |
| Suggesting mode (track changes) | 🔲 Planned | Record insertions/deletions as proposals; accept/reject per-change |
| Resolve thread + reopen | 🔲 Planned | Part of comments feature; resolved comments hidden but browsable |

---

## FreeSync-Specific Features

Features unique to FreeSync that Google Docs doesn't have.

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Obsidian file explorer presence | P0 | ✅ Done | Badges on file names showing who's in each file |
| Self-hosted relay server | P1 | ✅ Done | Railway deployment at `wss://freesync-production.up.railway.app`; plugin settings has relayUrl |
| Vault-level access control | P1 | ✅ Schema done | vault_members table + invite codes; management UI needed |
| Multi-device presence | P1 | ✅ Done | Works by design — awareness keyed by clientID (per-connection), not userId; same user on two devices shows as two separate indicators |
| Offline editing + sync on reconnect | P2 | 🔲 Planned | Yjs handles this natively via CRDT; needs testing + conflict UX |
| Mobile file browser | P2 | 🔲 Phase 2+ | Browse and open vault files from mobile |
| Push notifications | P2 | 🔲 Phase 4 | FCM; needs server-side notification dispatch |
| Pricing tier enforcement | P3 | 🔲 Phase 4 | Vault count limits, member count limits per tier |

---

## Mobile App Features (Phase 2)

Expo app screens to build — match `packages/app/prototype/freesync-prototype.jsx` exactly.

| Screen | Status | Notes |
|--------|--------|-------|
| Onboarding | 🔲 | Sign Up / Sign In choice |
| Sign Up | 🔲 | Name, email, password, self-hosted toggle |
| Sign In | 🔲 | Email, password |
| Vault List | 🔲 | Owned + member vaults, live collaborator avatars |
| Share Vault | 🔲 | Invite by email, copy share link, remove members |
| Upgrade | 🔲 | Plus/Pro/Enterprise pricing, yearly/monthly toggle |
| Account Settings | 🔲 | Display name, email, links to Servers + Upgrade |
| Self-Hosted Servers | 🔲 | Add/remove custom relay URLs |

---

## Web Dashboard Features (Phase 3)

Next.js app at `packages/web/`.

| Page | Status | Notes |
|------|--------|-------|
| Sign In / Sign Up | 🔲 | Auth flow |
| Account Settings | 🔲 | Profile, subscription status |
| Pricing Page | 🔲 | Plus/Pro/Enterprise, yearly/monthly toggle |
| Stripe Checkout | 🔲 | Scaffold only in Phase 3; live in Phase 4 |

---

## Pricing (Reference)

| Tier | Web | Mobile | Vault Limit | Collab Limit |
|------|-----|--------|-------------|--------------|
| Free | $0 | $0 | 1 owned | 3 users/vault |
| Plus | $12/yr | $14/yr | 5 owned | 10 users/vault |
| Pro | $24/yr | $28/yr | Unlimited | Unlimited |
| Enterprise | Custom | Custom | Unlimited | Unlimited + SSO |

Mobile prices are $2–4/yr higher to offset app store cut (Apple 30%, Google 15–30%).
