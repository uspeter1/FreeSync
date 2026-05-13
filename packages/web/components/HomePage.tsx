'use client';
import React, { useState, useEffect } from 'react';
import { THEME, USERS, User } from './theme';
import { Icon, UserBadge } from './Icon';

function RemoteCursor({ user }: { user: { name: string; color: string } }) {
  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <span style={{ display: 'inline-block', width: 2, height: '1.1em', background: user.color, borderRadius: 1, verticalAlign: 'text-bottom', marginRight: 1 }} />
      <span style={{
        position: 'absolute', bottom: '100%', left: -1,
        background: user.color, color: '#000',
        fontSize: 10, fontWeight: 700,
        padding: '1px 5px 1px 4px', borderRadius: '3px 3px 3px 0',
        whiteSpace: 'nowrap', fontFamily: 'system-ui, sans-serif',
        pointerEvents: 'none', lineHeight: '17px', marginBottom: 2, zIndex: 10,
      }}>
        {user.name}
      </span>
    </span>
  );
}

function useHeroAnim() {
  const BEFORE = 'The '; const AFTER = ' for Obsidian';
  const [mid, setMid] = useState('Google Docs');
  const [cursor, setCursor] = useState<User | null>(null);
  const [sel, setSel] = useState(false);

  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    async function editCycle(user: User, from: string, to: string) {
      if (!alive) return;
      setCursor(user); setSel(false);
      setMid(from);
      await sleep(500);
      setSel(true);
      await sleep(600);
      setSel(false);
      for (let i = from.length - 1; i >= 0; i--) {
        if (!alive) return;
        setMid(from.slice(0, i));
        await sleep(45 + Math.random() * 30);
      }
      await sleep(80);
      for (let i = 1; i <= to.length; i++) {
        if (!alive) return;
        setMid(to.slice(0, i));
        await sleep(55 + Math.random() * 35);
      }
      await sleep(300);
      setCursor(null);
    }

    async function loop() {
      await sleep(1800);
      while (alive) {
        await editCycle(USERS.alex, 'Google Docs', 'Free Sync Tool');
        await sleep(2200);
        await editCycle(USERS.maya, 'Free Sync Tool', 'Google Docs');
        await sleep(1600);
      }
    }
    loop();
    return () => { alive = false; };
  }, []);

  return { BEFORE, AFTER, mid, cursor, sel };
}

function HeroSubtitle() {
  const { BEFORE, AFTER, mid, cursor, sel } = useHeroAnim();
  const selBg = cursor ? cursor.color + '2a' : 'transparent';
  return (
    <div style={hmS.blockquote}>
      <span>{BEFORE}</span>
      <span style={sel ? { background: selBg, borderRadius: 2 } : {}}>
        {cursor ? <><RemoteCursor user={cursor} />{mid}</> : mid}
      </span>
      <span>{AFTER}</span>
    </div>
  );
}

function CursorDemo() {
  const alexLines = [
    'The average Obsidian Sync user pays $96/yr — no collaboration included.',
    'With Yjs CRDTs, every keystroke syncs in under 50ms.',
    "Real-time presence means you always know who's editing what.",
  ];
  const mayaLines = [
    'also need mobile presence badges on vault view',
    'check WebSocket reconnect on flaky networks',
    'add conflict resolution UI to the file explorer',
  ];

  const [aText, setAText] = useState('');
  const [mText, setMText] = useState('');
  const [aIdx, setAIdx]   = useState(0);
  const [mIdx, setMIdx]   = useState(0);

  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const typeInto = async (phrases: string[], idx: number, setter: (v: string) => void, setIdx: (fn: (v: number) => number) => void, baseDelay: number) => {
      const phrase = phrases[idx % phrases.length];
      await sleep(baseDelay);
      for (let i = 0; i <= phrase.length; i++) {
        if (!alive) return;
        setter(phrase.slice(0, i));
        await sleep(52 + Math.random() * 38);
      }
      await sleep(900);
      for (let i = phrase.length; i >= 0; i--) {
        if (!alive) return;
        setter(phrase.slice(0, i));
        await sleep(22 + Math.random() * 18);
      }
      if (alive) setIdx(v => v + 1);
    };

    let aRound = 0, mRound = 0;
    const run = async () => {
      while (alive) {
        await Promise.all([
          typeInto(alexLines, aRound, setAText, setAIdx, 0),
          typeInto(mayaLines, mRound, setMText, setMIdx, 320),
        ]);
        aRound++; mRound++;
        await sleep(600);
      }
    };
    run();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={hmS.demoBox}>
      <div style={hmS.demoHeader}>
        <span style={hmS.demoTag}>LIVE DEMO</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <UserBadge user={USERS.alex} size={18} />
          <span style={hmS.demoUserName}>Alex</span>
          <UserBadge user={USERS.maya} size={18} />
          <span style={hmS.demoUserName}>Maya</span>
        </div>
      </div>
      <div style={hmS.demoNote}>
        <div style={hmS.demoH2}>## FreeSync Design Notes</div>
        <div style={hmS.demoBlank} />
        <div style={hmS.demoLine}>
          <span style={{ color: THEME.textMuted, marginRight: 8 }}>↳</span>
          {aText}<RemoteCursor user={USERS.alex} />
        </div>
        <div style={hmS.demoBlank} />
        <div style={hmS.demoLine}>Action items:</div>
        <div style={hmS.demoLine}>
          <span style={{ color: THEME.textMuted, marginRight: 4 }}>-</span>
          {mText}<RemoteCursor user={USERS.maya} />
        </div>
      </div>
      <div style={hmS.demoExplorer}>
        <div style={hmS.demoExplorerTitle}>FILE EXPLORER</div>
        {[
          { name: 'Design Notes.md', user: USERS.alex },
          { name: 'Roadmap.md',      user: USERS.maya },
          { name: 'Architecture.md', user: null as null },
        ].map(f => (
          <div key={f.name} style={hmS.demoFile}>
            <Icon name="files" size={12} color={THEME.textMuted} />
            <span style={hmS.demoFileName}>{f.name}</span>
            {f.user && <UserBadge user={f.user} size={14} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncDemo() {
  const [files, setFiles] = useState([
    { name: 'Meeting Notes.md',  status: 'synced'   },
    { name: 'Architecture.md',   status: 'syncing'  },
    { name: 'Sprint Review.md',  status: 'synced'   },
    { name: 'New Document.md',   status: 'new'      },
    { name: 'Research.md',       status: 'conflict' },
  ]);

  useEffect(() => {
    const timers = [
      setTimeout(() => setFiles(f => f.map(x => x.status === 'syncing'  ? { ...x, status: 'synced' }  : x)), 2200),
      setTimeout(() => setFiles(f => f.map(x => x.status === 'new'      ? { ...x, status: 'synced' }  : x)), 3800),
      setTimeout(() => setFiles(f => f.map(x => x.status === 'conflict' ? { ...x, status: 'syncing' } : x)), 4200),
      setTimeout(() => setFiles(f => f.map(x => x.status === 'syncing'  ? { ...x, status: 'synced' }  : x)), 5600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const statusIcon = (s: string) => ({
    synced:   { icon: '✓', color: THEME.green,  label: 'Synced'    },
    syncing:  { icon: '↻', color: THEME.amber,  label: 'Syncing…'  },
    new:      { icon: '+', color: THEME.link,   label: 'New'       },
    conflict: { icon: '△', color: THEME.pink,   label: 'Conflict'  },
  }[s] || { icon: '', color: THEME.textMuted, label: '' });

  return (
    <div style={hmS.syncDemo}>
      {files.map(f => {
        const st = statusIcon(f.status);
        return (
          <div key={f.name} style={hmS.syncFile}>
            <Icon name="files" size={13} color={THEME.textMuted} />
            <span style={hmS.syncFileName}>{f.name}</span>
            <span style={{ fontSize: 11, color: st.color, fontWeight: 600, fontFamily: "'Courier New', monospace", display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13 }}>{st.icon}</span>
              {st.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const PLANS = [
  {
    name: 'Free', price: '$0', period: 'forever',
    badge: null,
    features: ['1 owned vault', 'Full real-time sync', 'Live cursors & presence', 'Unlimited devices', 'Unlimited notes', 'Unlimited members'],
    cta: 'Install Plugin', accent: false,
  },
  {
    name: 'Plus', price: '$12', period: '/yr  ·  $14/yr mobile',
    badge: 'POPULAR',
    features: ['5 owned vaults', 'Everything in Free', 'Priority relay routing', 'Email invites', 'Version history (30d)', 'Early feature access'],
    cta: 'Get Plus', accent: true,
  },
  {
    name: 'Pro', price: '$24', period: '/yr  ·  $28/yr mobile',
    badge: null,
    features: ['Unlimited owned vaults', 'Everything in Plus', 'Version history (unlimited)', '@mention notifications', 'Inline comments (P2)', 'Priority support'],
    cta: 'Get Pro', accent: false,
  },
];

function PricingCard({ plan }: { plan: typeof PLANS[number] }) {
  return (
    <div style={{ ...hmS.pricingCard, ...(plan.accent ? hmS.pricingCardAccent : {}) }}>
      {plan.badge && <div style={hmS.pricingBadge}>{plan.badge}</div>}
      <div style={hmS.planName}>{plan.name}</div>
      <div style={hmS.planPrice}>
        <span style={hmS.planPriceNum}>{plan.price}</span>
        <span style={hmS.planPeriod}>{plan.period}</span>
      </div>
      <div style={hmS.planDivider} />
      <ul style={hmS.planFeatures}>
        {plan.features.map(f => (
          <li key={f} style={hmS.planFeature}>
            <Icon name="check" size={13} color={plan.accent ? THEME.accent : THEME.green} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button style={{ ...hmS.planCta, ...(plan.accent ? hmS.planCtaAccent : {}) }}>
        {plan.cta}
      </button>
    </div>
  );
}

const FEATURES = [
  { icon: 'cursor' as const, title: 'Live Cursors',         desc: 'See exactly where each collaborator is in any file — colored caret + name label, just like Google Docs.' },
  { icon: 'users'  as const, title: 'Presence in Explorer', desc: "Colored initials badges appear next to filenames in the file explorer so you always know who's editing what." },
  { icon: 'zap'    as const, title: 'Real-Time Sync',       desc: 'Yjs CRDTs merge edits from multiple users with no conflicts. Sub-50ms latency on our relay.' },
  { icon: 'sync'   as const, title: 'Full File Sync',       desc: 'Create, rename, delete — all file operations sync instantly across all connected vaults.' },
  { icon: 'comment'as const, title: 'Inline Comments',      desc: 'Highlight any text and leave a comment. Threads sync in real time, just like in this demo.' },
  { icon: 'shield' as const, title: 'AGPL-3.0 Licensed',   desc: 'Fully open source. Audit the code, fork it, self-host it. Your data stays under your control.' },
  { icon: 'server' as const, title: 'Self-Hostable',        desc: 'Run your own relay on any VPS. Set DISABLE_TIER_LIMITS=true and everything is free for your team.' },
  { icon: 'package'as const, title: 'Conflict-Free CRDTs',  desc: 'Built on Yjs — the same CRDT engine that powers Notion, Linear, and countless other realtime apps.' },
];

const PRO_TIPS = [
  { title: 'Invite Anyone — Even on Free', body: 'Members can join unlimited shared vaults on any plan. Copy your vault invite link from FreeSync Settings and share it. Collaborators see your presence in the file explorer instantly.' },
  { title: 'Point to Your Own Relay', body: 'Self-hosting is a single Docker command. Set DISABLE_TIER_LIMITS=true and your whole team gets unlimited vaults at no cost. Update the plugin relay URL under Settings → FreeSync → Custom Relay URL.' },
  { title: 'Room Names Must Match Exactly', body: 'CRDTs are magic, but only if all clients connect to the same room. FreeSync encodes file paths as ${vaultId}/${encodeURIComponent(filePath)} — a mismatch is a silent failure where clients never sync.' },
];

function ProTipSection({ index }: { index: number }) {
  const tip = PRO_TIPS[(index - 1) % PRO_TIPS.length];
  return (
    <div id={`sec-protip-${index}`} style={{ padding: '40px 0 0' }}>
      <div style={{
        background: 'rgba(124,92,252,0.07)',
        border: `1px solid ${THEME.accent}44`,
        borderLeft: `3px solid ${THEME.accent}`,
        borderRadius: '0 8px 8px 0',
        padding: '16px 20px',
        animation: 'fadeIn 0.4s ease',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: THEME.accent, fontFamily: "'Courier New', monospace", marginBottom: 6 }}>
          #{index} PRO TIP
        </div>
        <h3 style={{ ...hmS.h3, marginTop: 0, marginBottom: 8 }}>{tip.title}</h3>
        <p style={{ ...hmS.body, marginBottom: 0 }}>{tip.body}</p>
      </div>
    </div>
  );
}

export function HomePage({ proTipCount = 0 }: { proTipCount?: number }) {
  return (
    <div>
      <div id="sec-welcome" style={{ paddingBottom: 56 }}>
        <h1 style={hmS.h1}>Welcome to FreeSync</h1>
        <HeroSubtitle />
        <p style={hmS.body}>
          FreeSync brings Google-Docs-style real-time collaboration to{' '}
          <a href="https://obsidian.md" style={hmS.link} target="_blank" rel="noopener noreferrer">Obsidian</a>.
          See live cursors, get presence badges in the file explorer,
          and sync edits across vaults in under 50 ms — all for free.
        </p>
        <p style={{ ...hmS.body, color: THEME.textMuted, fontSize: 13 }}>
          Obsidian Sync costs $96/yr with no collaboration.
          FreeSync starts free, adds real-time co-editing, and self-hosting is always available.
        </p>
        <div style={hmS.ctaRow}>
          <a href="/auth/signup" style={hmS.ctaPrimary}>
            Get Started Free
          </a>
          <a href="https://github.com/freesync/freesync" target="_blank" rel="noopener noreferrer" style={hmS.ctaSecondary}>
            <Icon name="github" size={15} color={THEME.textMuted} />
            View on GitHub
          </a>
          <a href="#sec-pricing" style={hmS.ctaGhost} onClick={e => {
            e.preventDefault();
            document.getElementById('sec-pricing')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            See pricing →
          </a>
        </div>
      </div>

      <div style={hmS.divider} />

      <div id="sec-syncing" style={{ padding: '52px 0' }}>
        <h2 style={hmS.h2}>Effortless Syncing Built for Collaboration</h2>
        <p style={hmS.body}>
          Multiple people can edit the same note simultaneously. Colored cursors show
          who&apos;s where. Initials badges appear next to files in the explorer.
          Every change propagates instantly via Yjs CRDTs — no merge conflicts, ever.
        </p>
        <CursorDemo />
      </div>

      <div style={hmS.divider} />

      <div id="sec-features" style={{ padding: '52px 0' }}>
        <h2 style={hmS.h2}>Features</h2>
        <p style={hmS.body}>
          Everything you need to turn Obsidian into a collaborative workspace.
        </p>
        <div style={hmS.featGrid}>
          {FEATURES.map(f => (
            <div key={f.title} style={hmS.featCard}>
              <div style={hmS.featIcon}><Icon name={f.icon} size={18} color={THEME.accent} /></div>
              <div style={hmS.featTitle}>{f.title}</div>
              <div style={hmS.featDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
        <h3 style={hmS.h3}>File Sync Status</h3>
        <p style={{ ...hmS.body, marginBottom: 16 }}>
          Every synced file shows its current state. Conflicts surface immediately.
        </p>
        <SyncDemo />
      </div>

      <div style={hmS.divider} />

      <div id="sec-opensource" style={{ padding: '52px 0' }}>
        <h2 style={hmS.h2}>Open Source & Self-Hostable</h2>
        <p style={hmS.body}>
          FreeSync is <strong style={{ color: THEME.textBright }}>AGPL-3.0 licensed</strong>.
          The relay server, plugin, and all infrastructure code are publicly auditable.
          Self-hosting takes one command — set <code style={hmS.inlineCode}>DISABLE_TIER_LIMITS=true</code> to
          run free for your whole team.
        </p>
        <div style={hmS.codeBlock}>
          <div style={hmS.codeHeader}>
            <span style={hmS.codeLang}>bash</span>
          </div>
          <pre style={hmS.codePre}>{`# Self-host the FreeSync relay
docker run -d \\
  -e SUPABASE_URL=https://your-project.supabase.co \\
  -e SUPABASE_ANON_KEY=your-anon-key \\
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \\
  -e DISABLE_TIER_LIMITS=true \\
  -p 3001:3001 \\
  ghcr.io/freesync/relay:latest`}</pre>
        </div>
        <div style={hmS.callout}>
          <span style={hmS.calloutIcon}>🔒</span>
          <div>
            <strong style={{ color: THEME.textBright }}>Your data stays yours.</strong>
            {' '}The plugin authenticates via your own Supabase project.
            The relay routes Yjs updates only to authenticated vault members.
          </div>
        </div>
      </div>

      <div style={hmS.divider} />

      <div id="sec-pricing" style={{ padding: '52px 0 12px' }}>
        <h2 style={hmS.h2}>Pricing</h2>
        <p style={hmS.body}>
          Limits apply to <strong style={{ color: THEME.textBright }}>vault owners</strong> only.
          Members can join unlimited shared vaults on any plan — including Free.
          Mobile is priced slightly higher to cover App Store fees.
        </p>
        <div style={hmS.pricingGrid}>
          {PLANS.map(p => <PricingCard key={p.name} plan={p} />)}
        </div>
        <p style={{ ...hmS.body, color: THEME.textMuted, fontSize: 13, marginTop: 24 }}>
          Self-hosting is always free with no limits. Payments are deferred until the POC is validated.
        </p>
      </div>

      {proTipCount > 0 && Array.from({ length: proTipCount }, (_, i) => (
        <ProTipSection key={i + 1} index={i + 1} />
      ))}
    </div>
  );
}

export const hmS: Record<string, React.CSSProperties> = {
  h1: { fontFamily: 'Georgia, serif', fontSize: 30, fontWeight: 700, color: THEME.textBright, margin: '0 0 18px', lineHeight: 1.25, letterSpacing: '-0.3px' },
  h2: { fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: THEME.textBright, margin: '0 0 14px', lineHeight: 1.3, letterSpacing: '-0.2px' },
  h3: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600, color: THEME.textBright, margin: '32px 0 10px', lineHeight: 1.3 },
  body: { fontSize: 15, lineHeight: 1.7, color: THEME.text, margin: '0 0 14px' },
  blockquote: { borderLeft: `3px solid ${THEME.accent}`, padding: '10px 16px', margin: '0 0 20px', background: THEME.accentSoft, borderRadius: '0 6px 6px 0', fontSize: 18, fontWeight: 500, color: THEME.textBright, lineHeight: 1.5, fontFamily: 'Georgia, serif', position: 'relative' },
  link: { color: THEME.link, textDecoration: 'none', cursor: 'pointer' },
  ctaRow: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24, alignItems: 'center' },
  ctaPrimary: { display: 'inline-flex', alignItems: 'center', gap: 7, background: THEME.accent, color: '#fff', textDecoration: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none' },
  ctaSecondary: { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', color: THEME.text, textDecoration: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 14, border: `1px solid ${THEME.border}`, cursor: 'pointer' },
  ctaGhost: { display: 'inline-flex', alignItems: 'center', color: THEME.textMuted, textDecoration: 'none', fontSize: 14, cursor: 'pointer' },
  divider: { height: 1, background: THEME.border, margin: '0' },
  demoBox: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, overflow: 'hidden', marginTop: 24 },
  demoHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: `1px solid ${THEME.border}`, background: THEME.bg },
  demoTag: { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: THEME.accent, fontFamily: "'Courier New', monospace" },
  demoUserName: { fontSize: 12, color: THEME.textMuted },
  demoNote: { padding: '18px 20px 14px', fontFamily: "'Courier New', monospace", fontSize: 13, lineHeight: 1.75, color: THEME.text },
  demoH2: { color: THEME.accent, fontWeight: 600, marginBottom: 4 },
  demoBlank: { height: 6 },
  demoLine: { display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 0, minHeight: 20 },
  demoExplorer: { borderTop: `1px solid ${THEME.border}`, padding: '10px 14px', background: THEME.bg },
  demoExplorerTitle: { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: THEME.textMuted, fontFamily: "'Courier New', monospace", marginBottom: 6 },
  demoFile: { display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0' },
  demoFileName: { flex: 1, fontSize: 12, color: THEME.text },
  syncDemo: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden' },
  syncFile: { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', borderBottom: `1px solid ${THEME.border}`, fontSize: 13, color: THEME.text },
  syncFileName: { flex: 1, fontSize: 13 },
  featGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 20, marginBottom: 32 },
  featCard: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 },
  featIcon: { width: 32, height: 32, background: THEME.accentSoft, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  featTitle: { fontSize: 13, fontWeight: 600, color: THEME.textBright },
  featDesc: { fontSize: 12, color: THEME.textMuted, lineHeight: 1.55 },
  codeBlock: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden', margin: '20px 0' },
  codeHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: `1px solid ${THEME.border}`, background: THEME.bg },
  codeLang: { fontSize: 11, color: THEME.textMuted, fontFamily: "'Courier New', monospace" },
  codePre: { margin: 0, padding: '16px 18px', fontSize: 12.5, fontFamily: "'Courier New', monospace", color: '#a78bfa', lineHeight: 1.65, overflowX: 'auto' },
  inlineCode: { fontFamily: "'Courier New', monospace", fontSize: 12.5, background: THEME.surface, padding: '1px 5px', borderRadius: 3, color: '#a78bfa' },
  callout: { display: 'flex', gap: 12, alignItems: 'flex-start', background: THEME.surface, border: `1px solid ${THEME.border}`, borderLeft: `3px solid ${THEME.accent}`, borderRadius: '0 8px 8px 0', padding: '12px 16px', fontSize: 13.5, color: THEME.text, lineHeight: 1.6, marginTop: 16 },
  calloutIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  pricingGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 14, marginTop: 22 },
  pricingCard: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', overflow: 'hidden' },
  pricingCardAccent: { border: `1px solid ${THEME.accent}`, boxShadow: `0 0 0 1px ${THEME.accent}22, 0 0 24px ${THEME.accent}18` },
  pricingBadge: { position: 'absolute', top: 0, right: 0, background: THEME.accent, color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '3px 9px', borderRadius: '0 10px 0 6px', fontFamily: "'Courier New', monospace" },
  planName: { fontSize: 12, fontWeight: 700, color: THEME.textMuted, letterSpacing: '0.06em', fontFamily: "'Courier New', monospace", marginBottom: 8 },
  planPrice: { display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 },
  planPriceNum: { fontSize: 30, fontWeight: 700, color: THEME.textBright, fontFamily: 'Georgia, serif' },
  planPeriod: { fontSize: 11, color: THEME.textMuted, lineHeight: 1.3 },
  planDivider: { height: 1, background: THEME.border, margin: '14px 0' },
  planFeatures: { listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 7, flex: 1 },
  planFeature: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, color: THEME.text, lineHeight: 1.4 },
  planCta: { background: THEME.surfaceHigh, border: `1px solid ${THEME.border}`, borderRadius: 7, padding: '8px 0', fontSize: 13, color: THEME.text, cursor: 'pointer', fontWeight: 600, width: '100%' },
  planCtaAccent: { background: THEME.accent, border: 'none', color: '#fff' },
};
