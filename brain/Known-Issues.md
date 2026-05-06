# Known Issues

Track bugs, tech debt, workarounds, and deferred work here. Every agent should check this before starting and update it when they discover or fix issues.

Format: `- [STATUS] Description — discovered by [agent] on [date]`

Status values: `[OPEN]` `[IN PROGRESS]` `[FIXED]` `[DEFERRED]` `[WONTFIX]`

---

## Phase 0 (Bootstrap)

No application code yet — no known issues.

---

## Architectural Debt to Watch

- `[DEFERRED]` Docker image for self-hosters — deferred until post-POC (Phase 4)
- `[DEFERRED]` Stripe + RevenueCat payment wiring — deferred until post-POC (Phase 4)
- `[DEFERRED]` Next.js web dashboard (packages/web/) — Phase 3
- `[DEFERRED]` File browser in mobile app — Phase 2 doesn't include file browsing, only vault management
- `[DEFERRED]` FCM push notifications — Phase 4+
- `[DEFERRED]` @mentions — P2 feature
- `[DEFERRED]` Inline comments on selections — P2 feature
- `[DEFERRED]` Version history / snapshots — P2 feature

## Lessons Learned (pre-project research)

- `[WONTFIX]` `border-left` for nav highlights — conflicts with Obsidian's inline `padding-inline-start`. Use `box-shadow: inset 3px 0 0 <color>` instead.
- `[WONTFIX]` Appending presence badges to outer `.nav-file-title` div — breaks Obsidian's flex layout. Always append to `.tree-item-inner`.
- `[WONTFIX]` Using `yText.observe()` for remote change detection — fires on local changes too, causes echo loops. Use `doc.on('update', (update, origin) => ...)` with LOCAL_ORIGIN check.
- `[WONTFIX]` Delete-all + insert-all sync strategy — produces conflict garbage under concurrent editing. Always use minimal diff.
