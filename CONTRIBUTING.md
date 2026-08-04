# Contributing

Pull requests are welcome — anyone can open one, I'll review and merge. Bug reports, feature ideas, docs fixes, tests, and refactors are all fair game.

## Working locally

The [README](README.md#local-development) has the exact setup for the four packages (relay, web dashboard, plugin, mobile scaffold). [SELF_HOSTING.md](SELF_HOSTING.md) covers a permanent self-hosted setup end-to-end if you'd rather test against your own stack.

## Bug reports

Open an issue with the [bug template](.github/ISSUE_TEMPLATE/bug.md). A useful report includes:

- **What you did** — the sequence of clicks / commands / edits
- **What you expected** to happen
- **What actually** happened
- **Version** — plugin `manifest.json` → `version`, relay commit SHA
- **Environment** — Obsidian version, OS, whether you self-hosted or ran locally
- **Console errors** — Obsidian dev tools (Ctrl/Cmd+Shift+I) for the plugin, `journalctl -u freesync-relay` for the server

A short, reliable reproduction beats a long guess at the cause.

## Feature requests

Open an issue with the [feature template](.github/ISSUE_TEMPLATE/feature.md). Frame the request as a user story rather than a proposed implementation — the implementation shape often has to change once it hits the invariants in [`brain/Decisions-Log.md`](brain/Decisions-Log.md).

## Pull requests

- Branch off `main`. Fork if you're an outside contributor.
- Small, focused PRs merge fastest. One concern per PR keeps review sane.
- Include a short test plan in the PR description — the exact steps someone should take to verify the change works.
- If you're touching sync, presence, storage, or persistence, skim [`brain/Decisions-Log.md`](brain/Decisions-Log.md) and [`brain/Known-Issues.md`](brain/Known-Issues.md) first. Several past regressions caused real data loss; the fixes there are load-bearing.
- Expect review turnaround within a few days. Ping the PR if it's been longer than a week.

## Questions

Open a discussion or an issue — whichever fits. There's no chat channel yet.
