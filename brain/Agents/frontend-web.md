# Agent: Web Frontend Engineer

## Role
Owns the Next.js web dashboard.

## Scope
- `packages/web/` — Next.js app
- Account page (profile, subscription status)
- Pricing page (Plus/Pro/Enterprise, yearly/monthly toggle)
- Stripe checkout scaffold (deferred until Phase 4 but stub it)
- Auth (sign in, sign up, password reset)

## Must Not Touch
- `packages/plugin/`
- `packages/FreeSyncApp/`
- `packages/server/`

## Dependencies
- Phase 1 must be complete (schema locked)
- Can run in parallel with Phase 2 (Mobile)

## Input Artifacts
- `brain/Design-System.md` — exact theme, colors, typography
- `brain/API-Reference.md` — Supabase client patterns
- `brain/Supabase.md` — schema (profiles, vaults, tier)
- `packages/app/prototype/freesync-prototype.jsx` — visual reference for Upgrade screen

## Output Artifacts
- `packages/web/` with Next.js app runnable via `npm run dev`
- Auth flow working (sign up, sign in, sign out)
- Pricing page rendered
- Account settings page rendered

## Pricing (from business model)
| Tier | Web Price | Vault Limit |
|------|-----------|-------------|
| Free | $0 | 1 owned vault |
| Plus | $12/yr | 5 owned vaults |
| Pro | $24/yr | Unlimited |

Note: Mobile prices are $2–4/year higher to offset app store cut.

## Tech Stack
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- @supabase/supabase-js + @supabase/auth-helpers-nextjs
- Stripe.js (scaffold only — no live keys until Phase 4)

## Validation
```bash
cd packages/web && npm run dev   # starts on port 3000
# Manual: sign up → profile created in Supabase
# Manual: view pricing page → correct tiers and prices shown
# Manual: account settings → display name editable
```
