'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { THEME } from '@/components/theme';

// Presence color palette — matches the default palette in the
// on_auth_user_created trigger (see brain/Supabase.md).
const PALETTE = ['#f472b6', '#60a5fa', '#4ade80', '#fb923c', '#a78bfa', '#f59e0b', '#34d399'];

interface Profile {
  id: string;
  display_name: string | null;
  color: string | null;
}

export default function ProfileSettings() {
  const sessionState = useSession();
  const userId = !sessionState.loading ? sessionState.session?.user.id : undefined;
  const email = !sessionState.loading ? sessionState.session?.user.email ?? '' : '';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, color')
        .eq('id', userId)
        .single();
      if (error) { setError(error.message); return; }
      setProfile(data);
      setNameDraft(data?.display_name ?? '');
      setColorDraft(data?.color ?? PALETTE[0]);
    })();
  }, [userId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: nameDraft.trim() || null,
        color: colorDraft,
      })
      .eq('id', userId);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setFlash('Saved.');
    setTimeout(() => setFlash((v) => (v === 'Saved.' ? null : v)), 3000);
    setProfile({ id: userId, display_name: nameDraft.trim() || null, color: colorDraft });
  };

  const dirty =
    profile != null &&
    (nameDraft.trim() !== (profile.display_name ?? '') || colorDraft !== (profile.color ?? PALETTE[0]));

  if (sessionState.loading || !profile) {
    return <div style={{ color: THEME.textMuted, fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div>
      <a href="/dashboard" style={styles.back}>← Dashboard</a>
      <h1 style={styles.pageTitle}>Profile</h1>
      <div style={styles.subtle}>This is how you appear to other people in your vaults.</div>

      {error && <div style={styles.error}>{error}</div>}
      {flash && <div style={styles.success}>{flash}</div>}

      <form onSubmit={save} style={styles.form}>
        {/* Preview */}
        <div style={styles.preview}>
          <div style={{ ...styles.avatar, background: colorDraft }}>
            {(nameDraft.trim() || email)[0]?.toUpperCase() ?? '?'}
          </div>
          <div>
            <div style={styles.previewName}>{nameDraft.trim() || '(no name)'}</div>
            <div style={styles.previewEmail}>{email}</div>
          </div>
        </div>

        {/* Display name */}
        <label style={styles.fieldLabel}>Display name</label>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="How other people see you"
          style={styles.input}
          maxLength={60}
        />
        <div style={styles.help}>Shown on cursors, presence badges, and member lists.</div>

        {/* Color */}
        <label style={styles.fieldLabel}>Presence color</label>
        <div style={styles.paletteRow}>
          {PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColorDraft(c)}
              aria-label={`Color ${c}`}
              style={{
                ...styles.swatch,
                background: c,
                outline: c === colorDraft ? `2px solid ${THEME.textBright}` : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        <div style={styles.help}>Your cursor, avatar, and file badges use this color.</div>

        {/* Email — readonly */}
        <label style={styles.fieldLabel}>Email</label>
        <input
          type="email"
          value={email}
          disabled
          style={{ ...styles.input, opacity: 0.6, cursor: 'not-allowed' }}
        />
        <div style={styles.help}>Change your email in your Supabase account for now.</div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="submit" disabled={!dirty || busy} style={{ ...styles.primaryBtn, opacity: dirty ? 1 : 0.5 }}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button
              type="button"
              style={styles.linkBtn}
              onClick={() => {
                setNameDraft(profile.display_name ?? '');
                setColorDraft(profile.color ?? PALETTE[0]);
              }}
            >
              Discard
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  back: { display: 'inline-block', marginBottom: 16, fontSize: 13, color: THEME.textMuted, textDecoration: 'none' },
  pageTitle: { fontSize: 24, fontWeight: 600, color: THEME.textBright, fontFamily: 'Georgia, serif', marginBottom: 4 },
  subtle: { fontSize: 12, color: THEME.textMuted, marginBottom: 24 },
  form: { padding: 24, background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, maxWidth: 520 },
  preview: { display: 'flex', alignItems: 'center', gap: 14, padding: 14, marginBottom: 20, background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 8 },
  avatar: { width: 44, height: 44, borderRadius: '50%', color: '#fff', fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  previewName: { fontSize: 14, fontWeight: 600, color: THEME.textBright },
  previewEmail: { fontSize: 12, color: THEME.textMuted, marginTop: 2 },
  fieldLabel: { display: 'block', fontSize: 12, fontWeight: 600, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: { display: 'block', width: '100%', padding: '10px 12px', background: THEME.bg, color: THEME.textBright, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 13, outline: 'none' },
  help: { fontSize: 11, color: THEME.textMuted, marginTop: 4 },
  paletteRow: { display: 'flex', gap: 10 },
  swatch: { width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 },
  primaryBtn: { padding: '9px 18px', background: THEME.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  linkBtn: { padding: '9px 6px', background: 'transparent', color: THEME.textMuted, border: 'none', fontSize: 13, cursor: 'pointer' },
  error: { padding: '10px 14px', background: 'rgba(244,114,182,0.08)', border: `1px solid ${THEME.pink}`, color: THEME.pink, borderRadius: 6, fontSize: 13, marginBottom: 16 },
  success: { padding: '10px 14px', background: 'rgba(74,222,128,0.08)', border: `1px solid ${THEME.green}`, color: THEME.green, borderRadius: 6, fontSize: 13, marginBottom: 16 },
};
