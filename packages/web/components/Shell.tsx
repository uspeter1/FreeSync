'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { THEME, USERS, YOU, PRESENCE_POOL, User } from './theme';
import { Icon, UserBadge } from './Icon';
import { RightPanel, PAGE_META, UserComment } from './RightPanel';
import { useSession } from '@/lib/session';

const TABS = [
  { id: 'home',            label: '1. Welcome to FreeSync', closeable: true  },
  { id: 'getting-started', label: 'Getting Started',        closeable: false },
  { id: 'docs',            label: 'Docs',                   closeable: false },
  { id: 'self-hosting',    label: 'Self Hosting',           closeable: false },
  { id: 'blog',            label: 'Blog',                   closeable: false },
];

const TOC: Record<string, { id: string; label: string; depth: number }[]> = {
  home: [
    { id: 'sec-welcome',    label: 'Welcome to FreeSync',         depth: 0 },
    { id: 'sec-syncing',    label: 'Effortless Syncing',          depth: 0 },
    { id: 'sec-features',   label: 'Features',                    depth: 0 },
    { id: 'sec-opensource', label: 'Open Source & Self-Hostable', depth: 0 },
    { id: 'sec-pricing',    label: 'Pricing',                     depth: 0 },
  ],
  'getting-started': [
    { id: 'gs-install', label: 'Installation',         depth: 0 },
    { id: 'gs-account', label: 'Create an Account',    depth: 0 },
    { id: 'gs-connect', label: 'Connect Your Vault',   depth: 0 },
    { id: 'gs-invite',  label: 'Invite Collaborators', depth: 0 },
  ],
  docs: [
    { id: 'docs-overview', label: 'Overview',        depth: 0 },
    { id: 'docs-plugin',   label: 'Plugin API',      depth: 0 },
    { id: 'docs-relay',    label: 'Relay Server',    depth: 0 },
    { id: 'docs-schema',   label: 'Database Schema', depth: 0 },
  ],
  'self-hosting': [
    { id: 'sh-why',      label: 'Why Self-Host',    depth: 0 },
    { id: 'sh-docker',   label: 'Docker Setup',     depth: 0 },
    { id: 'sh-env',      label: 'Environment Vars', depth: 0 },
    { id: 'sh-supabase', label: 'Supabase Config',  depth: 0 },
  ],
  blog: [
    { id: 'blog-why',    label: 'Why We Built FreeSync', depth: 0 },
    { id: 'blog-crdt',   label: 'CRDTs & Yjs',           depth: 0 },
    { id: 'blog-launch', label: 'Open Source & Pricing', depth: 0 },
  ],
};

function SelectionPopover({ onComment }: { onComment: (text: string) => void }) {
  const [pos, setPos]         = useState<{ x: number; y: number } | null>(null);
  const [selText, setSelText] = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    const onUp = () => {
      clearTimeout(hideTimer);
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) {
          hideTimer = setTimeout(() => setPos(null), 250);
          return;
        }
        const text  = sel.toString().trim();
        const range = sel.getRangeAt(0);
        const rect  = range.getBoundingClientRect();
        setSelText(text);
        setPos({ x: rect.left + rect.width / 2, y: rect.top });
      }, 30);
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-sel-popover]')) {
        hideTimer = setTimeout(() => setPos(null), 200);
      }
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  if (!pos) return null;

  const btn = (label: string, color: string, onClick: () => void) => (
    <button data-sel-popover onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
      background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12, color, borderRadius: 4, fontWeight: 500,
      whiteSpace: 'nowrap',
      fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif",
    }}>
      {label}
    </button>
  );

  return (
    <div data-sel-popover style={{
      position: 'fixed',
      left: pos.x, top: pos.y - 6,
      transform: 'translate(-50%, -100%)',
      background: THEME.surfaceHigh,
      border: `1px solid ${THEME.borderMid}`,
      borderRadius: 8, display: 'flex', gap: 0, zIndex: 150,
      boxShadow: '0 6px 20px rgba(0,0,0,0.55)',
      overflow: 'hidden', pointerEvents: 'all',
    }}>
      {btn('💬 Comment', THEME.link, () => {
        onComment(selText);
        setPos(null);
        window.getSelection()?.removeAllRanges();
      })}
      <div style={{ width: 1, background: THEME.border, margin: '6px 0' }} />
      {btn('🖊 Highlight', THEME.amber, () => {
        setPos(null);
        window.getSelection()?.removeAllRanges();
      })}
      <div style={{ width: 1, background: THEME.border, margin: '6px 0' }} />
      {btn(copied ? '✓ Copied' : '⎘ Copy', THEME.textMuted, () => {
        navigator.clipboard?.writeText(selText).catch(() => {});
        setCopied(true);
        setTimeout(() => { setCopied(false); setPos(null); }, 1200);
      })}
    </div>
  );
}

interface ShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  commentsOpen: boolean;
  setCommentsOpen: (v: boolean) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onGraphOpen: () => void;
  onAddProTip: () => void;
  onQuickSwitcherOpen: () => void;
  extraTocItems?: { id: string; label: string; depth: number }[];
  children: React.ReactNode;
}

export function ObsidianShell({
  activeTab, setActiveTab,
  commentsOpen, setCommentsOpen,
  contentRef,
  onGraphOpen,
  onAddProTip,
  onQuickSwitcherOpen,
  extraTocItems = [],
  children,
}: ShellProps) {
  const [leftOpen,      setLeftOpen]      = useState(true);
  const [presence,      setPresence]      = useState<Record<string, User[]>>({});
  const sessionState = useSession();
  const isSignedIn = !sessionState.loading && !!sessionState.session;
  const [activeSection, setActiveSection] = useState('');
  const [activeRibbon,  setActiveRibbon]  = useState('files');
  const [rightTab,      setRightTab]      = useState('comments');
  const [userComments,  setUserComments]  = useState<UserComment[]>([]);

  // Presence drift
  useEffect(() => {
    const allItems = [...(TOC[activeTab] || TOC.home), ...extraTocItems];
    const ids = allItems.map(i => i.id);
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const next: Record<string, User[]> = {};
      PRESENCE_POOL.forEach(u => {
        const key = ids[Math.floor(Math.random() * ids.length)];
        next[key] = [...(next[key] || []), u];
      });
      setPresence(next);
    };
    tick();
    const id = setInterval(tick, 4200);
    return () => { alive = false; clearInterval(id); };
  }, [activeTab, extraTocItems.length]);

  // Scroll-based "You" tracking
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const allItems = [...(TOC[activeTab] || TOC.home), ...extraTocItems];
    const handle = () => {
      const st = container.scrollTop;
      let cur = allItems[0]?.id || '';
      for (const item of allItems) {
        const el = document.getElementById(item.id);
        if (el && el.offsetTop - st <= 120) cur = item.id;
      }
      setActiveSection(cur);
    };
    handle();
    container.addEventListener('scroll', handle);
    return () => container.removeEventListener('scroll', handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRef.current, activeTab, extraTocItems.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); onQuickSwitcherOpen(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); onGraphOpen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGraphOpen, onQuickSwitcherOpen]);

  const addUserComment = useCallback((quotedText: string) => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setUserComments(prev => [...prev, { id: Date.now(), user: YOU, time: now, quote: quotedText, text: '' }]);
    setRightTab('comments');
    setCommentsOpen(true);
  }, [setCommentsOpen]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    const c  = contentRef.current;
    if (el && c) c.scrollTop = el.offsetTop - 28;
  };

  const toggleRightPanel = (tab: string) => {
    if (commentsOpen && rightTab === tab) setCommentsOpen(false);
    else { setRightTab(tab); setCommentsOpen(true); }
  };

  const tocItems = [...(TOC[activeTab] || TOC.home), ...extraTocItems];
  const activeTabD = TABS.find(t => t.id === activeTab);

  const ribbonBtns = [
    { id: 'files',    icon: 'files' as const,    title: 'File Explorer',          fn: () => { setLeftOpen(v => !v); setActiveRibbon('files'); } },
    { id: 'account',  icon: 'users' as const,    title: 'Comments',               fn: () => { toggleRightPanel('comments'); setActiveRibbon('account'); } },
    { id: 'switcher', icon: 'search' as const,   title: 'Quick Switcher (Ctrl+K)',  fn: () => { onQuickSwitcherOpen(); setActiveRibbon('switcher'); } },
    { id: 'graph',    icon: 'graph' as const,    title: 'Graph View (Ctrl+P)',      fn: () => { onGraphOpen(); } },
    { id: 'tags',     icon: 'tags' as const,     title: 'Tags',                   fn: () => { toggleRightPanel('tags'); setActiveRibbon('tags'); } },
    { id: 'calendar', icon: 'bookmark' as const, title: 'Backlinks',              fn: () => { toggleRightPanel('backlinks'); setActiveRibbon('calendar'); } },
    { id: 'outline',  icon: 'outline' as const,  title: 'Outline',                fn: () => { setLeftOpen(true); setActiveRibbon('outline'); } },
    { id: 'terminal', icon: 'code' as const,     title: 'Command Palette',        fn: () => { onQuickSwitcherOpen(); setActiveRibbon('terminal'); } },
  ];

  const pageMeta = PAGE_META[activeTab] || PAGE_META.home;

  return (
    <div style={shS.app}>
      <SelectionPopover onComment={addUserComment} />

      {/* Ribbon */}
      <div style={shS.ribbon}>
        <div style={shS.ribbonGroup}>
          {ribbonBtns.map(btn => {
            const isAct = activeRibbon === btn.id && btn.id !== 'graph';
            return (
              <button key={btn.id} title={btn.title} style={{
                ...shS.ribbonBtn,
                background: isAct ? THEME.accentSoft : 'none',
              }} onClick={btn.fn}>
                <Icon name={btn.icon} size={17} color={isAct ? THEME.accent : THEME.textMuted} />
              </button>
            );
          })}
        </div>
        <div style={shS.ribbonGroup}>
          <a href="/auth/signin" style={{ ...shS.ribbonBtn, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Sign In">
            <Icon name="users" size={17} color={THEME.accent} />
          </a>
          <button style={shS.ribbonBtn} title="Settings">
            <Icon name="settings" size={17} />
          </button>
        </div>
      </div>

      {/* Left panel */}
      {leftOpen && (
        <div style={shS.leftPanel}>
          <div style={shS.lpActionRow}>
            <button title="New note (adds Pro Tip)" style={shS.lpActionBtn} onClick={onAddProTip}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={THEME.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button title="New folder" style={shS.lpActionBtn}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={THEME.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
            <button title="Quick switcher" style={shS.lpActionBtn} onClick={onQuickSwitcherOpen}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={THEME.textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          </div>

          <div style={shS.tocList}>
            {tocItems.map(item => {
              const isCur = activeSection === item.id;
              const badges = [...(presence[item.id] || []), ...(isCur ? [YOU] : [])];
              return (
                <button key={item.id} style={{ ...shS.tocItem, ...(isCur ? shS.tocActive : {}) }}
                  onClick={() => scrollTo(item.id)}>
                  {isCur && <span style={shS.tocBar} />}
                  <span style={{ ...shS.tocLabel, paddingLeft: item.depth * 14 + (isCur ? 10 : 6) }}>
                    {item.label}
                  </span>
                  {badges.length > 0 && (
                    <div style={shS.badgeRow}>
                      {badges.slice(0, 3).map((u, i) => <UserBadge key={u.name + i} user={u} size={14} />)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div style={shS.lpFooter}>
            <span style={shS.lpVaultName}>◆ FreeSync</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <a href="/auth/signin" style={{ ...shS.iconBtn, textDecoration: 'none' }} title="Sign In">
                <Icon name="users" size={13} color={THEME.accent} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={shS.mainArea}>
        {/* Tab bar */}
        <div style={shS.tabBar}>
          <div style={shS.tabList}>
            {TABS.map(tab => (
              <button key={tab.id}
                style={{ ...shS.tab, ...(activeTab === tab.id ? shS.tabActive : {}) }}
                onClick={() => setActiveTab(tab.id)}>
                <span style={shS.tabLabel}>{tab.label}</span>
                {tab.closeable && <span style={shS.tabClose}><Icon name="close" size={11} color={THEME.textMuted} /></span>}
              </button>
            ))}
            {isSignedIn && (
              <button
                style={{ ...shS.tab, ...(activeTab === 'my-dashboard' ? shS.tabActive : {}) }}
                onClick={() => setActiveTab('my-dashboard')}
              >
                <span style={shS.tabLabel}>My Dashboard</span>
              </button>
            )}
            <a href="https://github.com/freesync/freesync" target="_blank" rel="noopener noreferrer"
              style={{ ...shS.tab, textDecoration: 'none' }}>
              <span style={shS.tabLabel}>GitHub ↗</span>
            </a>
          </div>
          <button style={shS.tabAdd} title="New tab (adds Pro Tip)" onClick={onAddProTip}>
            <Icon name="plus" size={14} />
          </button>
          <div style={shS.winCtrls}>
            <span style={{ ...shS.winBtn, background: '#ff5f56' }} />
            <span style={{ ...shS.winBtn, background: '#ffbd2e' }} />
            <span style={{ ...shS.winBtn, background: '#27c93f' }} />
          </div>
        </div>

        {/* Toolbar */}
        <div style={shS.toolbar}>
          <button style={shS.iconBtn} title="Back"><Icon name="back" size={16} /></button>
          <button style={shS.iconBtn} title="Forward"><Icon name="forward" size={16} /></button>
          <span style={shS.toolbarTitle}>{activeTabD?.label}</span>
          <div style={{ flex: 1 }} />
          {[
            { tab: 'backlinks',  icon: 'link' as const,    title: 'Backlinks'      },
            { tab: 'outgoing',   icon: 'popout' as const,  title: 'Outgoing Links' },
            { tab: 'tags',       icon: 'tags' as const,    title: 'Tags'           },
            { tab: 'properties', icon: 'files' as const,   title: 'Properties'     },
            { tab: 'comments',   icon: 'comment' as const, title: 'Comments'       },
          ].map(t => (
            <button key={t.tab} title={t.title} style={{
              ...shS.iconBtn,
              ...(commentsOpen && rightTab === t.tab ? { background: THEME.accentSoft } : {}),
            }} onClick={() => toggleRightPanel(t.tab)}>
              <Icon name={t.icon} size={15} color={commentsOpen && rightTab === t.tab ? THEME.accent : THEME.textMuted} />
            </button>
          ))}
          <button style={shS.iconBtn} title="More"><Icon name="more" size={15} /></button>
        </div>

        {/* Content */}
        <div style={shS.scroll} ref={contentRef}>
          <div style={shS.contentInner}>{children}</div>
        </div>
      </div>

      {/* Right panel */}
      {commentsOpen && (
        <RightPanel
          tab={rightTab}
          activeTab={activeTab}
          userComments={userComments}
          onClose={() => setCommentsOpen(false)}
        />
      )}

      {/* Status bar — Obsidian style: dark, subtle */}
      <div style={shS.statusBar}>
        <span style={shS.statusVault}>◆ FreeSync</span>
        <div style={shS.statusRight}>
          <span style={{ cursor: 'pointer' }} onClick={() => toggleRightPanel('backlinks')}>
            {(pageMeta?.backlinks?.length || 0)} backlinks
          </span>
          <span style={shS.statusDot}>·</span>
          <span>847 words</span>
          <span style={shS.statusDot}>·</span>
          <a href="/auth/signin" style={{ color: THEME.textMuted, textDecoration: 'none' }}>Sign in →</a>
        </div>
      </div>
    </div>
  );
}

const shS: Record<string, React.CSSProperties> = {
  app: { display: 'flex', width: '100vw', height: '100vh', background: THEME.bg, color: THEME.text, fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif", fontSize: 14, overflow: 'hidden', position: 'relative' },
  ribbon: { width: 40, flexShrink: 0, background: THEME.bg, borderRight: `1px solid ${THEME.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '6px 0', zIndex: 10 },
  ribbonGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
  ribbonBtn: { width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6 },
  leftPanel: { width: 240, flexShrink: 0, background: THEME.surface, borderRight: `1px solid ${THEME.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  lpActionRow: { display: 'flex', alignItems: 'center', padding: '5px 4px', borderBottom: `1px solid ${THEME.border}`, flexShrink: 0 },
  lpActionBtn: { width: 30, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, color: THEME.textMuted },
  tocList: { flex: 1, overflowY: 'auto', padding: '4px 2px' },
  tocItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, color: THEME.text, textAlign: 'left', gap: 4, position: 'relative', overflow: 'hidden' },
  tocActive: { background: 'rgba(124,92,252,0.1)', color: THEME.textBright },
  tocBar: { position: 'absolute', left: 0, top: '15%', bottom: '15%', width: 2, background: THEME.accent, borderRadius: 1, flexShrink: 0 },
  tocLabel: { fontSize: 13, color: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
  badgeRow: { display: 'flex', gap: 2, flexShrink: 0 },
  lpFooter: { borderTop: `1px solid ${THEME.border}`, padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  lpVaultName: { fontSize: 11, color: THEME.textMuted, fontWeight: 600, fontFamily: "'Courier New',monospace" },
  mainArea: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  tabBar: { display: 'flex', alignItems: 'center', background: THEME.bg, borderBottom: `1px solid ${THEME.border}`, minHeight: 37, flexShrink: 0 },
  tabList: { display: 'flex', flex: 1, overflow: 'hidden' },
  tab: { display: 'flex', alignItems: 'center', gap: 5, padding: '0 13px', height: 37, background: 'none', border: 'none', borderRight: `1px solid ${THEME.border}`, cursor: 'pointer', color: THEME.textMuted, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 },
  tabActive: { background: THEME.surface, color: THEME.textBright },
  tabLabel: { fontSize: 13 },
  tabClose: { display: 'flex', alignItems: 'center', opacity: 0.55, marginLeft: 1 },
  tabAdd: { width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, color: THEME.textMuted, flexShrink: 0 },
  winCtrls: { display: 'flex', gap: 6, alignItems: 'center', padding: '0 12px 0 6px', flexShrink: 0 },
  winBtn: { width: 12, height: 12, borderRadius: '50%', display: 'inline-block' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px', borderBottom: `1px solid ${THEME.border}`, flexShrink: 0, minHeight: 33 },
  toolbarTitle: { fontSize: 13, color: THEME.textMuted, marginLeft: 6 },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, padding: 4, color: THEME.textMuted },
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden' },
  contentInner: { maxWidth: 720, margin: '0 auto', padding: '44px 52px 60px' },
  statusBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 22, background: '#161616', borderTop: `1px solid ${THEME.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontSize: 11, color: THEME.textMuted, zIndex: 20, fontFamily: "'Courier New',monospace" },
  statusVault: { fontWeight: 600, color: THEME.textFaint, letterSpacing: '0.04em' },
  statusRight: { display: 'flex', alignItems: 'center', gap: 8 },
  statusDot: { opacity: 0.35 },
};
