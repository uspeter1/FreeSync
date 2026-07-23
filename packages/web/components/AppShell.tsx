'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { THEME } from './theme';
import { supabase } from '@/lib/supabase';

interface AppShellProps {
  session: Session;
  children: ReactNode;
}

// Authed chrome for the dashboard. Deliberately not a fork of ObsidianShell
// (which is a marketing prop with fixed tabs, hero animation, fake presence).
// Just header + scrollable main. Theme tokens are shared via THEME.
export function AppShell({ session, children }: AppShellProps) {
  // globals.css sets `overflow: hidden` on html/body/#__next so the marketing
  // shell can be a fixed viewport. Undo that here so authed pages can scroll,
  // and restore on unmount so the marketing shell still works if the user
  // navigates back.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  return (
    <div style={styles.root}>
      <Header session={session} />
      <main style={styles.main}>{children}</main>
    </div>
  );
}

function Header({ session }: { session: Session }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const email = session.user.email ?? '';
  const initials = initialsFromEmail(email);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = () => setMenuOpen(false);
    // Delay one tick so the toggle click doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', onClick); };
  }, [menuOpen]);

  return (
    <header style={styles.header}>
      <a href="/dashboard" style={styles.brand}>
        <span style={styles.brandDot} />
        <span>FreeSync</span>
      </a>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          style={styles.avatar}
          aria-label="Account menu"
        >
          {initials}
        </button>
        {menuOpen && (
          <div style={styles.menu} onClick={(e) => e.stopPropagation()}>
            <div style={styles.menuEmail} title={email}>{email}</div>
            <button type="button" onClick={signOut} style={styles.menuItem}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function initialsFromEmail(email: string): string {
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: THEME.bg,
    color: THEME.text,
    fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif",
    fontSize: 14,
  },
  header: {
    height: 56,
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: `1px solid ${THEME.border}`,
    background: THEME.surface,
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textDecoration: 'none',
    color: THEME.textBright,
    fontWeight: 600,
    fontSize: 15,
  },
  brandDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: THEME.accent,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: THEME.accent,
    color: '#fff',
    border: 'none',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    top: '110%',
    right: 0,
    minWidth: 220,
    background: THEME.surfaceHigh,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    overflow: 'hidden',
    zIndex: 20,
  },
  menuEmail: {
    padding: '10px 14px',
    fontSize: 12,
    color: THEME.textMuted,
    borderBottom: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    padding: '10px 14px',
    background: 'transparent',
    color: THEME.text,
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 13,
  },
  main: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '32px 24px 80px',
  },
};
