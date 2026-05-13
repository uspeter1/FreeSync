'use client';
import React, { useState, useEffect } from 'react';
import { THEME, USERS, User } from './theme';
import { Icon, UserBadge } from './Icon';

const PAGE_META: Record<string, {
  backlinks: { from: string; excerpt: string }[];
  outgoing: string[];
  tags: string[];
  properties: Record<string, string>;
}> = {
  home: {
    backlinks: [
      { from: 'Getting Started', excerpt: '"…install the FreeSync plugin from community plugins…"' },
      { from: 'Docs',           excerpt: '"…FreeSync relay server architecture and WebSocket protocol…"' },
      { from: 'Blog',           excerpt: '"…why we built FreeSync and what makes it different…"' },
    ],
    outgoing: ['Getting Started', 'Docs', 'Self Hosting', 'Blog', 'GitHub ↗', 'obsidian.md ↗', 'yjs.dev ↗'],
    tags: ['#obsidian', '#sync', '#real-time', '#collaboration', '#crdt', '#yjs', '#open-source', '#self-hostable'],
    properties: { Created: 'May 1, 2025', Modified: 'May 8, 2026', Author: 'FreeSync Team', Status: 'Published', License: 'AGPL-3.0' },
  },
  'getting-started': {
    backlinks: [{ from: 'Welcome to FreeSync', excerpt: '"…Jump to Install Instructions…"' }],
    outgoing: ['Docs', 'Self Hosting', 'obsidian.md ↗', 'freesync.app ↗'],
    tags: ['#installation', '#setup', '#guide', '#obsidian-plugin'],
    properties: { Created: 'May 1, 2025', Modified: 'May 8, 2026', ReadTime: '5 min' },
  },
  docs: {
    backlinks: [
      { from: 'Getting Started', excerpt: '"…see the Docs for full API reference…"' },
      { from: 'Self Hosting',    excerpt: '"…refer to the Docs for schema migrations…"' },
    ],
    outgoing: ['yjs.dev ↗', 'supabase.com ↗', 'Self Hosting'],
    tags: ['#api', '#relay', '#yjs', '#supabase', '#websocket', '#crdt'],
    properties: { Created: 'May 1, 2025', Modified: 'May 8, 2026', Type: 'Technical Reference' },
  },
  'self-hosting': {
    backlinks: [{ from: 'Welcome to FreeSync', excerpt: '"…Open Source & Self-Hostable…"' }],
    outgoing: ['Docs', 'hub.docker.com ↗', 'supabase.com ↗'],
    tags: ['#docker', '#self-host', '#supabase', '#open-source', '#agpl'],
    properties: { Created: 'May 1, 2025', Modified: 'May 8, 2026', Difficulty: 'Intermediate' },
  },
  blog: {
    backlinks: [{ from: 'Welcome to FreeSync', excerpt: '"…read our blog…"' }],
    outgoing: ['yjs.dev ↗', 'Docs', 'GitHub ↗'],
    tags: ['#blog', '#crdt', '#yjs', '#open-source', '#obsidian'],
    properties: { Created: 'March 2025', Posts: '3', Author: 'FreeSync Team' },
  },
};

interface UserComment { id: number; user: User; time: string; quote?: string; text: string; }

function CommentsTab({ userComments }: { userComments: UserComment[] }) {
  const [animText, setAnimText] = useState('');
  const [resolved, setResolved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const phrase = 'This is exactly what the Obsidian community needs.';
    let i = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      i++;
      setAnimText(phrase.slice(0, i));
      if (i < phrase.length) setTimeout(tick, 52 + Math.random() * 38);
    };
    const t = setTimeout(tick, 2400);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const resolve = (id: string) => setResolved(r => ({ ...r, [id]: true }));

  return (
    <div style={rpS.tabBody}>
      {userComments.map(c => (
        <div key={c.id} style={{ ...rpS.commentCard, borderLeft: `2px solid ${THEME.accent}` }}>
          <div style={rpS.commentMeta}>
            <UserBadge user={c.user} size={20} />
            <span style={rpS.commentAuthor}>{c.user.name}</span>
            <span style={rpS.commentTime}>{c.time}</span>
          </div>
          {c.quote && (
            <div style={{ fontSize: 11, color: THEME.textMuted, fontStyle: 'italic',
              borderLeft: `2px solid ${THEME.border}`, paddingLeft: 8, margin: '2px 0 4px' }}>
              &ldquo;{c.quote.slice(0, 80)}{c.quote.length > 80 ? '…' : ''}&rdquo;
            </div>
          )}
          <p style={rpS.commentBody}>{c.text || <span style={{ color: THEME.textMuted, fontStyle: 'italic' }}>No message added</span>}</p>
        </div>
      ))}

      {!resolved['c1'] ? (
        <div style={rpS.commentCard}>
          <div style={rpS.commentMeta}>
            <UserBadge user={USERS.sam} size={22} />
            <span style={rpS.commentAuthor}>sam</span>
            <span style={rpS.commentTime}>just now</span>
          </div>
          <p style={rpS.commentBody}>{animText}<span style={{ display:'inline-block', color:THEME.text, animation:'blink 1s step-end infinite' }}>|</span></p>
          <div style={rpS.commentFooter}>
            <button style={rpS.resolveBtn} onClick={() => resolve('c1')}>✓ Resolve</button>
            <button style={rpS.replyBtn}>Reply</button>
          </div>
        </div>
      ) : <div style={{ ...rpS.commentCard, opacity: 0.3 }}><span style={{ fontSize: 11, fontStyle: 'italic', color: THEME.textMuted }}>✓ Resolved</span></div>}

      <div style={rpS.commentCard}>
        <div style={rpS.commentMeta}>
          <UserBadge user={USERS.maya} size={22} />
          <span style={rpS.commentAuthor}>maya</span>
          <span style={rpS.commentTime}>01:47 PM</span>
        </div>
        <p style={rpS.commentBody}>We should have live comments in the landing page — animated cursors too!</p>
        <div style={{ ...rpS.commentCard, background: THEME.surface, padding: '7px 8px' }}>
          <div style={rpS.commentMeta}>
            <UserBadge user={USERS.alex} size={18} />
            <span style={{ ...rpS.commentAuthor, fontSize: 11 }}>alex</span>
            <span style={rpS.commentTime}>01:47 PM</span>
          </div>
          <p style={{ ...rpS.commentBody, fontSize: 12 }}>
            <span style={{ color: THEME.accent }}>@maya</span> the meta demo IS the pitch
          </p>
        </div>
        <div style={rpS.commentFooter}>
          {!resolved['c2']
            ? <><button style={rpS.resolveBtn} onClick={() => resolve('c2')}>✓ Resolve</button><button style={rpS.replyBtn}>Reply</button></>
            : <span style={{ fontSize: 11, fontStyle: 'italic', color: THEME.textMuted }}>✓ Resolved</span>}
        </div>
      </div>

      {!resolved['c3'] ? (
        <div style={rpS.commentCard}>
          <div style={rpS.commentMeta}>
            <UserBadge user={USERS.alex} size={22} />
            <span style={rpS.commentAuthor}>alex</span>
            <span style={rpS.commentTime}>02:12 PM</span>
          </div>
          <p style={rpS.commentBody}>$12/yr vs $96/yr for Obsidian Sync — and we get real-time collab on top.</p>
          <div style={rpS.commentFooter}>
            <button style={rpS.resolveBtn} onClick={() => resolve('c3')}>✓ Resolve</button>
            <button style={rpS.replyBtn}>Reply</button>
          </div>
        </div>
      ) : <div style={{ ...rpS.commentCard, opacity: 0.3 }}><span style={{ fontSize: 11, fontStyle: 'italic', color: THEME.textMuted }}>✓ Resolved</span></div>}
    </div>
  );
}

function BacklinksTab({ activeTab }: { activeTab: string }) {
  const meta = PAGE_META[activeTab] || PAGE_META.home;
  return (
    <div style={rpS.tabBody}>
      <div style={rpS.sectionHead}>
        <span style={rpS.sectionHeadLabel}>LINKED MENTIONS</span>
        <span style={rpS.sectionHeadCount}>{meta.backlinks.length}</span>
      </div>
      {meta.backlinks.map(b => (
        <div key={b.from} style={rpS.linkCard}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="files" size={12} color={THEME.accent} />
            <span style={{ fontSize: 13, color: THEME.link, fontWeight: 500 }}>{b.from}</span>
          </div>
          <p style={{ fontSize: 11.5, color: THEME.textMuted, lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>{b.excerpt}</p>
        </div>
      ))}
      <div style={{ ...rpS.sectionHead, marginTop: 16 }}>
        <span style={rpS.sectionHeadLabel}>UNLINKED MENTIONS</span>
        <span style={rpS.sectionHeadCount}>0</span>
      </div>
      <p style={{ fontSize: 12, color: THEME.textMuted, padding: '8px 0', margin: 0 }}>No unlinked mentions found.</p>
    </div>
  );
}

function OutgoingTab({ activeTab }: { activeTab: string }) {
  const meta = PAGE_META[activeTab] || PAGE_META.home;
  return (
    <div style={rpS.tabBody}>
      <div style={rpS.sectionHead}>
        <span style={rpS.sectionHeadLabel}>OUTGOING LINKS</span>
        <span style={rpS.sectionHeadCount}>{meta.outgoing.length}</span>
      </div>
      {meta.outgoing.map(link => (
        <div key={link} style={{ ...rpS.linkCard, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px' }}>
          <Icon name={link.includes('↗') ? 'popout' : 'files'} size={12} color={link.includes('↗') ? THEME.textMuted : THEME.accent} />
          <span style={{ fontSize: 13, color: link.includes('↗') ? THEME.textMuted : THEME.link }}>{link}</span>
        </div>
      ))}
    </div>
  );
}

function TagsTab({ activeTab }: { activeTab: string }) {
  const meta = PAGE_META[activeTab] || PAGE_META.home;
  return (
    <div style={rpS.tabBody}>
      <div style={rpS.sectionHead}>
        <span style={rpS.sectionHeadLabel}>TAGS</span>
        <span style={rpS.sectionHeadCount}>{meta.tags.length}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8 }}>
        {meta.tags.map(tag => (
          <span key={tag} style={{
            background: THEME.accentSoft, border: `1px solid ${THEME.accent}44`,
            color: THEME.link, borderRadius: 20, padding: '3px 10px',
            fontSize: 12, fontFamily: "'Courier New', monospace", cursor: 'pointer',
          }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function PropertiesTab({ activeTab }: { activeTab: string }) {
  const meta = PAGE_META[activeTab] || PAGE_META.home;
  return (
    <div style={rpS.tabBody}>
      <div style={rpS.sectionHead}>
        <span style={rpS.sectionHeadLabel}>PROPERTIES</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
        {Object.entries(meta.properties).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 8px', borderRadius: 4 }}>
            <span style={{ fontSize: 11.5, color: THEME.textMuted, width: 80, flexShrink: 0, fontFamily: "'Courier New', monospace" }}>{k}</span>
            <span style={{ fontSize: 12.5, color: THEME.text }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RightPanelProps {
  tab: string;
  activeTab: string;
  userComments: UserComment[];
  onClose: () => void;
}

export function RightPanel({ tab, activeTab, userComments, onClose }: RightPanelProps) {
  const tabDefs = [
    { id: 'comments',   icon: 'comment' as const,  title: 'Comments'       },
    { id: 'backlinks',  icon: 'link' as const,     title: 'Backlinks'      },
    { id: 'outgoing',   icon: 'popout' as const,   title: 'Outgoing Links' },
    { id: 'tags',       icon: 'tags' as const,     title: 'Tags'           },
    { id: 'properties', icon: 'files' as const,    title: 'Properties'     },
  ];
  const [activeTab2, setActiveTab2] = useState(tab || 'comments');
  const [replyText, setReplyText]   = useState('');

  useEffect(() => { if (tab) setActiveTab2(tab); }, [tab]);

  return (
    <div style={rpS.panel}>
      <div style={rpS.panelHead}>
        <span style={rpS.panelTitle}>{tabDefs.find(t => t.id === activeTab2)?.title.toUpperCase()}</span>
        <button style={rpS.iconBtn} onClick={onClose}><Icon name="close" size={13} /></button>
      </div>
      <div style={rpS.tabStrip}>
        {tabDefs.map(t => (
          <button key={t.id} title={t.title} style={{
            ...rpS.tabBtn,
            ...(activeTab2 === t.id ? rpS.tabBtnActive : {}),
          }} onClick={() => setActiveTab2(t.id)}>
            <Icon name={t.icon} size={14} color={activeTab2 === t.id ? THEME.accent : THEME.textMuted} />
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {activeTab2 === 'comments'   && <CommentsTab userComments={userComments} />}
        {activeTab2 === 'backlinks'  && <BacklinksTab activeTab={activeTab} />}
        {activeTab2 === 'outgoing'   && <OutgoingTab activeTab={activeTab} />}
        {activeTab2 === 'tags'       && <TagsTab activeTab={activeTab} />}
        {activeTab2 === 'properties' && <PropertiesTab activeTab={activeTab} />}
      </div>
      {activeTab2 === 'comments' && (
        <div style={rpS.replyArea}>
          <input
            placeholder="Reply… (type @ to mention)"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            style={rpS.replyInput}
          />
        </div>
      )}
    </div>
  );
}

const rpS: Record<string, React.CSSProperties> = {
  panel: { width: 272, flexShrink: 0, borderLeft: `1px solid ${THEME.border}`, background: THEME.surface, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px 6px', borderBottom: `1px solid ${THEME.border}`, flexShrink: 0 },
  panelTitle: { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: THEME.textMuted, fontFamily: "'Courier New', monospace" },
  tabStrip: { display: 'flex', borderBottom: `1px solid ${THEME.border}`, flexShrink: 0, padding: '3px 6px 0' },
  tabBtn: { flex: 1, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '4px 4px 0 0', borderBottom: '2px solid transparent' },
  tabBtnActive: { background: THEME.accentSoft, borderBottom: `2px solid ${THEME.accent}` },
  tabBody: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 6px', borderBottom: `1px solid ${THEME.border}`, marginBottom: 2 },
  sectionHeadLabel: { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: THEME.textMuted, fontFamily: "'Courier New', monospace" },
  sectionHeadCount: { fontSize: 11, color: THEME.textMuted, background: THEME.surfaceHigh, padding: '1px 6px', borderRadius: 10 },
  linkCard: { background: THEME.surfaceHigh, borderRadius: 6, padding: '8px 10px', cursor: 'pointer' },
  commentCard: { background: THEME.surfaceHigh, borderRadius: 7, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 5 },
  commentMeta: { display: 'flex', alignItems: 'center', gap: 6 },
  commentAuthor: { fontSize: 12, fontWeight: 600, color: THEME.textBright },
  commentTime: { fontSize: 10, color: THEME.textMuted, marginLeft: 'auto' },
  commentBody: { fontSize: 12.5, color: THEME.text, lineHeight: 1.55, margin: 0 },
  commentFooter: { display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 },
  resolveBtn: { background: THEME.surfaceHigh, border: `1px solid ${THEME.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, color: THEME.text, cursor: 'pointer' },
  replyBtn: { background: THEME.accent, border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 11, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  replyArea: { borderTop: `1px solid ${THEME.border}`, padding: 10, flexShrink: 0 },
  replyInput: { width: '100%', background: THEME.surfaceHigh, border: `1px solid ${THEME.border}`, borderRadius: 5, padding: '7px 9px', fontSize: 12, color: THEME.text, outline: 'none', boxSizing: 'border-box', fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif" },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, padding: 4, color: THEME.textMuted },
};

export { PAGE_META };
export type { UserComment };
