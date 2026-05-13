'use client';
import React, { useState, useEffect, useRef } from 'react';
import { THEME } from './theme';
import { Icon } from './Icon';

const QS_ITEMS = [
  { label: 'Welcome to FreeSync',        tab: 'home',           section: 'sec-welcome',    icon: 'files' as const },
  { label: 'Effortless Syncing',          tab: 'home',           section: 'sec-syncing',    icon: 'users' as const },
  { label: 'Features',                    tab: 'home',           section: 'sec-features',   icon: 'zap' as const },
  { label: 'Open Source & Self-Hostable', tab: 'home',           section: 'sec-opensource', icon: 'github' as const },
  { label: 'Pricing',                     tab: 'home',           section: 'sec-pricing',    icon: 'package' as const },
  { label: 'Getting Started',             tab: 'getting-started',                           icon: 'files' as const },
  { label: 'Installation',                tab: 'getting-started',section: 'gs-install',     icon: 'files' as const },
  { label: 'Create an Account',           tab: 'getting-started',section: 'gs-account',     icon: 'files' as const },
  { label: 'Connect Your Vault',          tab: 'getting-started',section: 'gs-connect',     icon: 'sync' as const },
  { label: 'Docs',                        tab: 'docs',                                       icon: 'files' as const },
  { label: 'Plugin API',                  tab: 'docs',           section: 'docs-plugin',    icon: 'code' as const },
  { label: 'Relay Server',                tab: 'docs',           section: 'docs-relay',     icon: 'server' as const },
  { label: 'Database Schema',             tab: 'docs',           section: 'docs-schema',    icon: 'files' as const },
  { label: 'Self Hosting',                tab: 'self-hosting',                               icon: 'server' as const },
  { label: 'Docker Setup',                tab: 'self-hosting',   section: 'sh-docker',      icon: 'server' as const },
  { label: 'Environment Variables',       tab: 'self-hosting',   section: 'sh-env',         icon: 'code' as const },
  { label: 'Blog',                        tab: 'blog',                                       icon: 'files' as const },
  { label: 'Why We Built FreeSync',       tab: 'blog',           section: 'blog-why',       icon: 'files' as const },
  { label: 'CRDTs & Yjs',                 tab: 'blog',           section: 'blog-crdt',      icon: 'package' as const },
];

interface QuickSwitcherProps {
  onClose: () => void;
  onNavigate: (item: { tab: string; section?: string; label: string }) => void;
}

export function QuickSwitcher({ onClose, onNavigate }: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [idx, setIdx]     = useState(0);
  const inputRef          = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = query.trim()
    ? QS_ITEMS.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
    : QS_ITEMS;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, filtered.length-1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
    if (e.key === 'Enter') {
      const item = filtered[idx];
      if (item) { onNavigate(item); onClose(); }
    }
  };

  return (
    <div
      style={{ position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-start',
        justifyContent:'center',paddingTop:'14vh',background:'rgba(0,0,0,0.72)' }}
      onClick={e => e.target===e.currentTarget && onClose()}
    >
      <div style={{
        width:580, background:THEME.surface, border:`1px solid ${THEME.borderMid}`,
        borderRadius:10, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,padding:'11px 16px',
          borderBottom:`1px solid ${THEME.border}` }}>
          <Icon name="search" size={15} color={THEME.textMuted} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Find or create a note…"
            style={{
              flex:1, background:'none', border:'none', outline:'none',
              fontSize:15, color:THEME.textBright,
              fontFamily:"-apple-system,'SF Pro Display',system-ui,sans-serif",
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background:'none',border:'none',cursor:'pointer',padding:2 }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div style={{ maxHeight:340, overflowY:'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding:'18px 16px',color:THEME.textMuted,fontSize:13,textAlign:'center' }}>
              No results for &quot;{query}&quot;
            </div>
          ) : filtered.map((item, i) => (
            <div
              key={item.label + i}
              style={{
                display:'flex', alignItems:'center', gap:9,
                padding:'9px 16px', cursor:'pointer',
                background: i===idx ? THEME.accentSoft : 'transparent',
                color: i===idx ? THEME.textBright : THEME.text,
                fontSize:14, transition:'background 0.08s',
                borderLeft: i===idx ? `2px solid ${THEME.accent}` : '2px solid transparent',
              }}
              onClick={() => { onNavigate(item); onClose(); }}
              onMouseEnter={() => setIdx(i)}
            >
              <Icon name={item.icon} size={13} color={i===idx ? THEME.accent : THEME.textMuted} />
              <span style={{ flex:1 }}>{item.label}</span>
              {item.section && (
                <span style={{ fontSize:10.5,color:THEME.textMuted,
                  fontFamily:"'Courier New',monospace",background:THEME.surfaceHigh,
                  padding:'1px 6px',borderRadius:3 }}>{item.tab}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop:`1px solid ${THEME.border}`,padding:'6px 14px',
          display:'flex',gap:16,flexWrap:'wrap' }}>
          {[['↑↓','navigate'],['↵','open'],['esc','dismiss']].map(([k,v])=>(
            <span key={k} style={{ fontSize:10.5,color:THEME.textMuted,fontFamily:"'Courier New',monospace" }}>
              <span style={{ color:THEME.text,marginRight:3 }}>{k}</span>{v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
