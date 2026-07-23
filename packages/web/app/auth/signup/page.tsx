'use client';
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

const T = {
  bg:         '#0f0f0f',
  surface:    '#1a1a1a',
  surfaceHi:  '#242424',
  border:     '#2a2a2a',
  accent:     '#7c5cfc',
  accentSoft: 'rgba(124,92,252,0.14)',
  text:       '#d4d4d4',
  textBright: '#efefef',
  textMuted:  '#6a6a6a',
  link:       '#a78bfa',
  green:      '#4ade80',
  pink:       '#f472b6',
};

export default function SignUpPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name || email.split('@')[0] } },
    });

    setLoading(false);
    if (err) { setError(err.message); return; }

    if (data.user && !data.session) {
      setSuccess(true);
    } else {
      window.location.href = '/dashboard';
    }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif" }}>
        <div style={{ width: '100%', maxWidth: 400, padding: '0 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✉️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.textBright, fontFamily: 'Georgia, serif', marginBottom: 12 }}>Check your email</h1>
          <p style={{ fontSize: 14, color: T.textMuted, lineHeight: 1.6, marginBottom: 24 }}>
            We sent a confirmation link to <strong style={{ color: T.textBright }}>{email}</strong>.
            Click it to activate your account and start syncing.
          </p>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 18px', fontSize: 13, color: T.textMuted, textAlign: 'left' }}>
            <div style={{ fontWeight: 600, color: T.textBright, marginBottom: 8 }}>Next steps:</div>
            <ol style={{ paddingLeft: 18, lineHeight: 2 }}>
              <li>Confirm your email</li>
              <li>Install the FreeSync Obsidian plugin</li>
              <li>Sign in with your credentials</li>
              <li>Start collaborating!</li>
            </ol>
          </div>
          <a href="/" style={{ display: 'inline-block', marginTop: 20, fontSize: 13, color: T.textMuted, textDecoration: 'none' }}>← Back to FreeSync</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "-apple-system,'SF Pro Display',system-ui,sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, background: T.accent, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.textBright, fontFamily: 'Georgia, serif' }}>FreeSync</span>
          </div>
          <p style={{ fontSize: 13, color: T.textMuted }}>Real-time collaboration for Obsidian</p>
        </div>

        {/* Value prop badges */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
          {['Free forever', 'Live cursors', 'Self-hostable', 'Open source'].map(label => (
            <span key={label} style={{ background: T.accentSoft, border: `1px solid ${T.accent}44`, color: T.link, borderRadius: 20, padding: '3px 12px', fontSize: 12, fontFamily: "'Courier New', monospace" }}>
              {label}
            </span>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '28px 24px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.textBright, fontFamily: 'Georgia, serif', marginBottom: 20, textAlign: 'center' }}>
            Create your free account
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {error && (
              <div style={{ background: `${T.pink}18`, border: `1px solid ${T.pink}44`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: T.pink }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, letterSpacing: '0.04em' }}>DISPLAY NAME</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name (optional)"
                style={{ background: T.surfaceHi, border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', fontSize: 14, color: T.textBright, outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, letterSpacing: '0.04em' }}>EMAIL</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                style={{ background: T.surfaceHi, border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', fontSize: 14, color: T.textBright, outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, letterSpacing: '0.04em' }}>PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="Min. 8 characters"
                style={{ background: T.surfaceHi, border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', fontSize: 14, color: T.textBright, outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, marginTop: 4 }}
            >
              {loading ? 'Creating account…' : 'Create Free Account'}
            </button>

            <p style={{ fontSize: 11.5, color: T.textMuted, textAlign: 'center', lineHeight: 1.5, margin: 0 }}>
              By signing up you agree to our terms of service.
              Your data is never sold. Self-hosting is always available.
            </p>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
            <span style={{ fontSize: 13, color: T.textMuted }}>Already have an account?{' '}</span>
            <a href="/auth/signin" style={{ fontSize: 13, color: T.link, textDecoration: 'none', fontWeight: 600 }}>Sign in</a>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/" style={{ fontSize: 13, color: T.textMuted, textDecoration: 'none' }}>← Back to FreeSync</a>
        </div>
      </div>
    </div>
  );
}
