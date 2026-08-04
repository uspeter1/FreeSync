'use client';
import React from 'react';
import { THEME } from './theme';

type IconName =
  | 'files' | 'search' | 'bookmark' | 'graph' | 'tags' | 'outline'
  | 'comment' | 'settings' | 'help' | 'close' | 'back' | 'forward'
  | 'more' | 'plus' | 'popout' | 'check' | 'link' | 'github' | 'sync'
  | 'users' | 'server' | 'zap' | 'package' | 'star' | 'code' | 'shield'
  | 'bolt' | 'eye' | 'cursor';

interface IconProps { name: IconName; size?: number; color?: string; }

export function Icon({ name, size = 16, color }: IconProps) {
  const c = color || THEME.textMuted;
  const p = { stroke: c, strokeWidth: '1.5', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  const paths: Record<string, React.ReactNode> = {
    files:    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" {...p}/>,
    search:   <><circle cx="11" cy="11" r="7" {...p}/><line x1="21" y1="21" x2="16.65" y2="16.65" {...p}/></>,
    bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" {...p}/>,
    graph:    <><circle cx="5" cy="12" r="2" {...p}/><circle cx="19" cy="5" r="2" {...p}/><circle cx="19" cy="19" r="2" {...p}/><path d="M7 12h5m3.5-4.5L12 12m7.5 4.5L12 12" {...p}/></>,
    tags:     <><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" {...p}/><circle cx="7" cy="7" r="1.5" fill={c} stroke="none"/></>,
    outline:  <><line x1="3" y1="6" x2="21" y2="6" {...p}/><line x1="3" y1="12" x2="15" y2="12" {...p}/><line x1="3" y1="18" x2="18" y2="18" {...p}/></>,
    comment:  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" {...p}/>,
    settings: <><circle cx="12" cy="12" r="3" {...p}/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" {...p}/></>,
    help:     <><circle cx="12" cy="12" r="10" {...p}/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" {...p}/><circle cx="12" cy="17" r=".5" fill={c} stroke="none"/></>,
    close:    <path d="M18 6L6 18M6 6l12 12" {...p}/>,
    back:     <path d="M15 18l-6-6 6-6" {...p}/>,
    forward:  <path d="M9 18l6-6-6-6" {...p}/>,
    more:     <><circle cx="12" cy="5" r="1" fill={c} stroke="none"/><circle cx="12" cy="12" r="1" fill={c} stroke="none"/><circle cx="12" cy="19" r="1" fill={c} stroke="none"/></>,
    plus:     <path d="M12 5v14M5 12h14" {...p}/>,
    popout:   <><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" {...p}/><polyline points="15 3 21 3 21 9" {...p}/><line x1="10" y1="14" x2="21" y2="3" {...p}/></>,
    check:    <path d="M20 6L9 17l-5-5" {...p}/>,
    link:     <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" {...p}/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" {...p}/></>,
    github:   <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" {...p}/>,
    sync:     <><polyline points="23 4 23 10 17 10" {...p}/><polyline points="1 20 1 14 7 14" {...p}/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" {...p}/></>,
    users:    <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" {...p}/><circle cx="9" cy="7" r="4" {...p}/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" {...p}/></>,
    server:   <><rect x="2" y="2" width="20" height="8" rx="2" {...p}/><rect x="2" y="14" width="20" height="8" rx="2" {...p}/><line x1="6" y1="6" x2="6.01" y2="6" {...p}/><line x1="6" y1="18" x2="6.01" y2="18" {...p}/></>,
    zap:      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" {...p}/>,
    package:  <><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" {...p}/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" {...p}/><polyline points="3.27 6.96 12 12.01 20.73 6.96" {...p}/><line x1="12" y1="22.08" x2="12" y2="12" {...p}/></>,
    star:     <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" {...p}/>,
    code:     <><polyline points="16 18 22 12 16 6" {...p}/><polyline points="8 6 2 12 8 18" {...p}/></>,
    shield:   <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p}/>,
    bolt:     <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" {...p}/>,
    eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></>,
    cursor:   <path d="M5 3l14 9-7 1-3 7L5 3z" {...p}/>,
  };

  return (
    <svg style={{ display: 'block', flexShrink: 0 }} width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      {paths[name] || null}
    </svg>
  );
}

export function UserBadge({ user, size = 18 }: { user: { initials: string; color: string }; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: user.color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.44), fontWeight: 700, color: '#000',
      flexShrink: 0, fontFamily: "'Courier New', monospace",
      letterSpacing: '-0.5px', userSelect: 'none',
    }}>
      {user.initials}
    </div>
  );
}
