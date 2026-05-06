# Agent: Mobile Frontend Engineer

## Role
Owns the React Native / Expo mobile app.

## Scope
- `packages/FreeSyncApp/` — all screens, navigation, Supabase wiring
- Match `packages/app/prototype/freesync-prototype.jsx` exactly
- Build validation (APK builds cleanly)

## Must Not Touch
- `packages/plugin/`
- `packages/server/`
- `packages/web/`

## Dependencies
- Phase 1 must be complete: Supabase schema locked, relay running
- Read `brain/Supabase.md` for schema, `brain/API-Reference.md` for endpoints
- Read `brain/Design-System.md` for colors, typography, spacing

## Input Artifacts
- `packages/app/prototype/freesync-prototype.jsx` — visual reference (READ THIS FIRST)
- `brain/Architecture.md` — Supabase client patterns
- `brain/API-Reference.md` — auth flows, vault CRUD
- `brain/Design-System.md` — theme, palette, component specs
- Android SDK at `/home/peter/android-sdk`, Java 17 at `/usr/lib/jvm/java-17-openjdk-amd64`

## Output Artifacts
- All 9 screens functional and matching prototype
- APK builds: `npm run build:android --workspace=packages/FreeSyncApp`
- APK at: `packages/FreeSyncApp/android/app/build/outputs/apk/debug/app-debug.apk`

## Screen List (match prototype exactly)
1. **Onboarding** — Sign Up / Sign In options
2. **Sign Up** — name, email, password, self-hosted server toggle
3. **Sign In** — email, password
4. **Vault List** — owned + member vaults, live collaborator avatars, Add Vault
5. **Share Vault** — invite by email, copy share link, remove members
6. **Upgrade** — Plus/Pro/Enterprise pricing cards, yearly/monthly toggle
7. **Account Settings** — display name, email, links to Servers, Upgrade
8. **Self-Hosted Servers** — add/remove custom relay server URLs

## Known Build Config (from memory — verify against actual files)
- `minSdkVersion`: 23
- `ndkVersion`: 26.1.10909125
- `buildToolsVersion`: 35.0.0
- `react-native-safe-area-context`: 4.10.1
- `react-native-screens`: 3.31.1
- `react-native-gesture-handler`: 2.16.2

## Validation
```bash
npm run build:android --workspace=packages/FreeSyncApp
# Manual: sign up → check Supabase profiles table for new user + auto-assigned color
# Manual: create vault → check Supabase vaults table
# Manual: copy invite code → join with second account → check vault_members
```

## Tech Stack
- React Native 0.74
- Expo SDK (latest stable)
- expo-router for navigation
- expo-secure-store for token storage
- @supabase/supabase-js for auth + data
