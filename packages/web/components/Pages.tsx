'use client';
import React from 'react';
import { THEME } from './theme';
import { hmS } from './HomePage';

function NoteH1({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h1 id={id} style={hmS.h1}>{children}</h1>;
}
function NoteH2({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h2 id={id} style={{ ...hmS.h2, marginTop: 40 }}>{children}</h2>;
}
function NoteP({ children }: { children: React.ReactNode }) {
  return <p style={hmS.body}>{children}</p>;
}
function NoteCode({ children }: { children: string }) {
  return (
    <div style={{ ...hmS.codeBlock, margin: '14px 0 22px' }}>
      <pre style={hmS.codePre}>{children}</pre>
    </div>
  );
}
function NoteCallout({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <div style={hmS.callout}>
      <span style={hmS.calloutIcon}>{emoji}</span>
      <div style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export function GettingStartedPage() {
  return (
    <div>
      <NoteH1>Getting Started</NoteH1>
      <p style={{ ...hmS.body, color: THEME.textMuted, marginBottom: 32 }}>
        From zero to real-time collaboration in under five minutes.
      </p>

      <NoteH2 id="gs-install">Installation</NoteH2>
      <NoteP>
        Open Obsidian and navigate to{' '}
        <code style={hmS.inlineCode}>Settings → Community Plugins → Browse</code>.
        Search for <strong style={{ color: THEME.textBright }}>FreeSync</strong> and click Install, then Enable.
      </NoteP>
      <NoteCallout emoji="📦">
        FreeSync is pending community plugin approval. Until then, install manually:
        download <code style={hmS.inlineCode}>main.js</code>, <code style={hmS.inlineCode}>manifest.json</code>,
        and <code style={hmS.inlineCode}>styles.css</code> from the latest GitHub release,
        place them in <code style={hmS.inlineCode}>.obsidian/plugins/freesync/</code>, and reload.
      </NoteCallout>

      <NoteH2 id="gs-account">Create an Account</NoteH2>
      <NoteP>
        Visit <a href="/auth/signup" style={hmS.link}>freesync.app/signup</a> and
        sign up with your email. A confirmation link will arrive within seconds.
        Your account starts on the Free tier — no credit card required.
      </NoteP>

      <NoteH2 id="gs-connect">Connect Your Vault</NoteH2>
      <NoteP>
        In Obsidian, open the FreeSync plugin settings. Paste your email and password,
        click <strong style={{ color: THEME.textBright }}>Sign In</strong>.
        The plugin will create a vault entry and begin syncing immediately.
        You&apos;ll see a small sync badge appear next to file names in the explorer.
      </NoteP>
      <NoteCode>{`# The plugin stores credentials securely
# and refreshes tokens automatically.
# No manual token management needed.`}</NoteCode>

      <NoteH2 id="gs-invite">Invite Collaborators</NoteH2>
      <NoteP>
        Go to <strong style={{ color: THEME.textBright }}>FreeSync Settings → Your Vaults</strong>,
        click the vault you want to share, and copy the invite link.
        Share it with anyone — they&apos;ll join as a member and start syncing instantly.
      </NoteP>
      <NoteCallout emoji="✨">
        Members can join unlimited shared vaults on any plan, including Free.
        Only vault <em>owners</em> are subject to the vault count limit.
      </NoteCallout>
    </div>
  );
}

export function DocsPage() {
  return (
    <div>
      <NoteH1>Documentation</NoteH1>
      <p style={{ ...hmS.body, color: THEME.textMuted, marginBottom: 32 }}>
        Technical reference for the plugin, relay server, and database schema.
      </p>

      <NoteH2 id="docs-overview">Overview</NoteH2>
      <NoteP>
        FreeSync consists of three components: the <strong style={{ color: THEME.textBright }}>Obsidian plugin</strong> (TypeScript),
        the <strong style={{ color: THEME.textBright }}>relay server</strong> (Node.js + y-websocket),
        and a <strong style={{ color: THEME.textBright }}>Supabase backend</strong> (auth, Postgres, RLS).
        CRDTs are handled by <a href="https://yjs.dev" style={hmS.link}>Yjs</a>.
      </NoteP>
      <NoteCode>{`┌─ Obsidian Plugin ─────┐   ┌─ Mobile App ─────────┐
│ sync.ts               │   │ VaultList            │
│ presence.ts           │   │ SignIn / SignUp       │
│ diff.ts               │   │ Vault management     │
└────────┬──────────────┘   └──────────┬───────────┘
         │ WebSocket (Yjs)             │ REST / Supabase JS
         ▼                             ▼
┌─ Relay Server :3001 ───────────────────────────────┐
│  /sync/:vaultId   y-websocket   auth gate          │
│  Yjs persistence to Supabase Storage               │
└────────────────────────┬───────────────────────────┘
                         │
                         ▼
                  ┌─ Supabase ─────────┐
                  │  Auth (JWT)        │
                  │  Postgres + RLS    │
                  │  Storage (binaries)│
                  └────────────────────┘`}</NoteCode>

      <NoteH2 id="docs-plugin">Plugin API</NoteH2>
      <NoteP>
        Room names follow the pattern{' '}
        <code style={hmS.inlineCode}>{`\${vaultId}/\${encodeURIComponent(filePath)}`}</code>.
        A global manifest room <code style={hmS.inlineCode}>{`\${vaultId}/__manifest__`}</code> carries
        presence awareness and file tree sync via <code style={hmS.inlineCode}>Y.Map</code>.
      </NoteP>
      <NoteCode>{`// Always connect to manifest room first
const manifestProvider = new WebsocketProvider(
  relayUrl,
  \`\${vaultId}/__manifest__\`,
  manifestDoc
);

// Per-file room for content + cursors
const fileProvider = new WebsocketProvider(
  relayUrl,
  \`\${vaultId}/\${encodeURIComponent(filePath)}\`,
  fileDoc
);`}</NoteCode>

      <NoteH2 id="docs-relay">Relay Server</NoteH2>
      <NoteP>
        The relay is a Node.js server running y-websocket with a Supabase JWT auth gate.
        It persists Yjs document state to Supabase Storage after each update batch.
        All connections are authenticated — unauthenticated WebSocket upgrades are rejected.
      </NoteP>

      <NoteH2 id="docs-schema">Database Schema</NoteH2>
      <NoteCode>{`profiles      — id, display_name, color, tier
vaults        — id, owner_id, name, invite_code
vault_members — vault_id, user_id, status
vault_docs    — vault_id, file_path, yjs_state, updated_at`}</NoteCode>
    </div>
  );
}

export function SelfHostingPage() {
  return (
    <div>
      <NoteH1>Self-Hosting</NoteH1>
      <p style={{ ...hmS.body, color: THEME.textMuted, marginBottom: 32 }}>
        FreeSync is AGPL-3.0 licensed. Run your own relay on any VPS in minutes.
      </p>

      <NoteH2 id="sh-why">Why Self-Host</NoteH2>
      <NoteP>
        Self-hosting gives you complete control over your data, removes any tier limits,
        and lets you run FreeSync in air-gapped or private environments.
        The relay is a single Docker image — no Kubernetes, no complexity.
      </NoteP>
      <NoteCallout emoji="🔓">
        Set <code style={hmS.inlineCode}>DISABLE_TIER_LIMITS=true</code> to give all users
        unlimited vaults. Perfect for teams, schools, or enterprises.
      </NoteCallout>

      <NoteH2 id="sh-docker">Docker Setup</NoteH2>
      <NoteCode>{`docker run -d \\
  --name freesync-relay \\
  -e SUPABASE_URL=https://your-project.supabase.co \\
  -e SUPABASE_ANON_KEY=your-anon-key \\
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \\
  -e DISABLE_TIER_LIMITS=true \\
  -e PORT=3001 \\
  -p 3001:3001 \\
  --restart unless-stopped \\
  ghcr.io/freesync/relay:latest`}</NoteCode>
      <NoteP>
        Point your Obsidian plugin at your relay URL via{' '}
        <code style={hmS.inlineCode}>Settings → FreeSync → Custom Relay URL</code>.
      </NoteP>

      <NoteH2 id="sh-env">Environment Variables</NoteH2>
      <div style={{ ...hmS.syncDemo, marginBottom: 20 }}>
        {[
          ['SUPABASE_URL', 'Your Supabase project URL'],
          ['SUPABASE_ANON_KEY', 'Public anon key (client-safe)'],
          ['SUPABASE_SERVICE_ROLE_KEY', 'Service role key (server-only)'],
          ['DISABLE_TIER_LIMITS', 'Set to "true" to remove all limits'],
          ['PORT', 'WebSocket port (default: 3001)'],
          ['LOG_LEVEL', '"info" | "debug" | "error"'],
        ].map(([k, v]) => (
          <div key={k} style={{ ...hmS.syncFile, flexWrap: 'wrap', gap: 6 }}>
            <code style={{ ...hmS.inlineCode, flex: '0 0 auto' }}>{k}</code>
            <span style={{ fontSize: 12, color: THEME.textMuted }}>{v}</span>
          </div>
        ))}
      </div>

      <NoteH2 id="sh-supabase">Supabase Config</NoteH2>
      <NoteP>
        FreeSync requires a Supabase project with the schema applied. Run the migration
        SQL from <code style={hmS.inlineCode}>supabase/migrations/</code> in the repo,
        or use the Supabase MCP to apply it automatically.
        Enable Row Level Security on all four tables.
      </NoteP>
    </div>
  );
}

const POSTS = [
  { id: 'blog-why',    title: 'Why We Built FreeSync',           date: 'May 2025',   excerpt: 'Obsidian Sync is $96/yr. It does not offer real-time collaboration. We thought we could do better — and for free.', readTime: '4 min read' },
  { id: 'blog-crdt',   title: 'CRDTs & Yjs: The Engine Behind Real-Time Collaboration', date: 'April 2025', excerpt: "Conflict-free replicated data types sound intimidating. Here's why they're the right choice for a sync plugin, and how Yjs makes them almost trivial to use.", readTime: '7 min read' },
  { id: 'blog-launch', title: 'Open Source & Pricing — Our Philosophy', date: 'March 2025', excerpt: "AGPL-3.0, self-hostable, free tier that actually works. Here's the thinking behind our business model.", readTime: '5 min read' },
];

export function BlogPage() {
  return (
    <div>
      <NoteH1>Blog</NoteH1>
      <p style={{ ...hmS.body, color: THEME.textMuted, marginBottom: 36 }}>
        Notes on building FreeSync — the tech, the decisions, the community.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {POSTS.map(post => (
          <div key={post.id} id={post.id} style={{ background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: '20px 22px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: THEME.textMuted, fontFamily: "'Courier New',monospace" }}>{post.date}</span>
              <span style={{ fontSize: 11, color: THEME.textFaint }}>·</span>
              <span style={{ fontSize: 11, color: THEME.textMuted }}>{post.readTime}</span>
            </div>
            <div style={{ ...hmS.h2, marginTop: 0, marginBottom: 8, fontSize: 17 }}>{post.title}</div>
            <p style={{ ...hmS.body, marginBottom: 12, color: THEME.textMuted, fontSize: 13.5 }}>{post.excerpt}</p>
            <span style={{ ...hmS.link, fontSize: 13 }}>Read more →</span>
          </div>
        ))}
      </div>
    </div>
  );
}
