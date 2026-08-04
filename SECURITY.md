# Security Policy

FreeSync handles user credentials (Supabase JWTs), private note contents (vault data), and accepts network input over WebSockets and HTTP. Vulnerability reports are welcome.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's **Private vulnerability reporting**:
[github.com/uspeter1/freesync/security/advisories/new](https://github.com/uspeter1/freesync/security/advisories/new)

If you can't use that, email the repository owner via GitHub — the reachable address is on their [GitHub profile](https://github.com/uspeter1).

Please include:

- FreeSync version (plugin `manifest.json` → `version`; relay commit SHA if self-hosting)
- A minimal reproduction, or a description of the attack scenario
- The impact you observed or theorize (auth bypass, data disclosure, DoS, etc.)

## Response

The project is pre-release with one active maintainer. Realistic expectations:

- **Acknowledgement**: within about a week
- **Assessment + planned fix window**: shared once the report is triaged
- **Coordinated disclosure**: default 90 days after a fix is available, or sooner by agreement

## Supported versions

Only the current `main` branch is supported. Any published GitHub release older than the latest may lack security fixes; there are no maintained release branches at this stage.

## Scope

In scope:

- Plugin (Obsidian client), relay server, web dashboard
- Anything that could leak, corrupt, or grant unauthorized access to vault contents or user auth state
- Anything that could cause the relay to serve one user's data to another

Out of scope:

- Findings that require a compromised Supabase project or a compromised host — the self-host security model assumes you trust your own infrastructure
- Weaknesses in third-party dependencies with existing published CVEs and known-good remediation paths (open an issue instead)
- Denial-of-service via unbounded resource requests when the relay has no rate limit configured — known gap, tracked separately
