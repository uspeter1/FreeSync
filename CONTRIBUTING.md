# Contributing

FreeSync is pre-release with a single active maintainer. **Outside pull requests are not being merged right now** — the API surface, schema, and file layouts still shift week to week, and a merged PR against the wrong invariant is expensive to unwind (some past regressions in this repo caused real data loss; see [`brain/Known-Issues.md`](brain/Known-Issues.md)).

What is genuinely helpful right now:

## Bug reports

Open an issue with the [bug template](.github/ISSUE_TEMPLATE/bug.md). A useful report includes:

- **What you did** — the sequence of clicks / commands / edits
- **What you expected** to happen
- **What actually** happened
- **Version** — plugin `manifest.json` → `version`, relay commit SHA
- **Environment** — Obsidian version, OS, whether you self-hosted or ran locally
- **Console errors** — Obsidian dev tools (Ctrl/Cmd+Shift+I) for the plugin, `journalctl -u freesync-relay` for the server

Reproductions matter more than diagnosis. A short paste that reliably breaks something is more useful than a guess at the cause.

## Security issues

Do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Feature requests

Open an issue with the [feature template](.github/ISSUE_TEMPLATE/feature.md). Frame the request as a user story rather than a proposed implementation — the implementation shape often has to change once it hits the invariants in [`brain/Decisions-Log.md`](brain/Decisions-Log.md).

## Working locally

If you want to hack on your own fork, the [README](README.md#local-development) has a `Local development` section with the exact commands, and [SELF_HOSTING.md](SELF_HOSTING.md) covers a permanent setup end-to-end.

## When will outside contributions open?

Realistically, once the API and schema stabilize enough that a merged PR isn't a debugging tax on the maintainer. No firm date. `brain/Phase-Status.md` tracks the shape of the near-term work.
