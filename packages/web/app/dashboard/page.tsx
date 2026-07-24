'use client';

import { useEffect, useState } from 'react';
import { relay, RelayError } from '@/lib/relay';
import type { Vault, MembershipStatus } from '@/lib/types';
import { THEME } from '@/components/theme';
import { useSession } from '@/lib/session';

export default function DashboardHome() {
  const sessionState = useSession();
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const data = await relay<Vault[]>('/vaults');
      setVaults(data);
    } catch (e) {
      setError(e instanceof RelayError ? e.message : String(e));
    }
  };

  useEffect(() => { void load(); }, []);

  const createVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await relay<Vault>('/vaults', { method: 'POST', body: { name: newName.trim() } });
      setNewName('');
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof RelayError ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const joinVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim() || busy) return;
    const trimmed = joinCode.trim();
    const slash = trimmed.indexOf('/');
    if (slash === -1) { setError('Invite code should look like "vaultId/inviteCode"'); return; }
    const vaultId = trimmed.slice(0, slash);
    const code = trimmed.slice(slash + 1);
    setBusy(true);
    try {
      await relay(`/vaults/${vaultId}/join`, { method: 'POST', body: { invite_code: code } });
      setJoinCode('');
      setJoining(false);
      await load();
    } catch (e) {
      setError(e instanceof RelayError ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const myUserId = !sessionState.loading ? sessionState.session?.user.id : undefined;

  return (
    <div>
      <div style={styles.headerRow}>
        <h1 style={styles.pageTitle}>Your vaults</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={() => { setJoining((v) => !v); setCreating(false); }}
          >
            Join by code
          </button>
          <button
            type="button"
            style={styles.primaryBtn}
            onClick={() => { setCreating((v) => !v); setJoining(false); }}
          >
            + New vault
          </button>
        </div>
      </div>

      {creating && (
        <form onSubmit={createVault} style={styles.inlineForm}>
          <input
            autoFocus
            type="text"
            placeholder="Vault name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={styles.input}
          />
          <button type="submit" disabled={busy || !newName.trim()} style={styles.primaryBtn}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={styles.linkBtn}>
            Cancel
          </button>
        </form>
      )}

      {joining && (
        <form onSubmit={joinVault} style={styles.inlineForm}>
          <input
            autoFocus
            type="text"
            placeholder="vaultId/inviteCode"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            style={{ ...styles.input, fontFamily: '"Courier New", monospace' }}
          />
          <button type="submit" disabled={busy || !joinCode.trim()} style={styles.primaryBtn}>
            {busy ? 'Joining…' : 'Join'}
          </button>
          <button type="button" onClick={() => { setJoining(false); setJoinCode(''); }} style={styles.linkBtn}>
            Cancel
          </button>
        </form>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {vaults === null && !error && <div style={styles.muted}>Loading…</div>}

      {vaults && (() => {
        // Each entry has exactly one vault_members row (filtered server-side
        // to the caller). Read its status once here.
        const myStatus = (v: Vault): MembershipStatus =>
          (v.vault_members?.[0]?.status ?? 'active') as MembershipStatus;
        const invited = vaults.filter((v) => myStatus(v) === 'invited');
        const active = vaults.filter((v) => myStatus(v) === 'active');

        if (active.length === 0 && invited.length === 0) {
          return (
            <div style={styles.empty}>
              <div style={{ fontSize: 15, color: THEME.textBright, marginBottom: 6 }}>No vaults yet</div>
              <div style={styles.muted}>Create a new vault above, or join one with an invite code.</div>
            </div>
          );
        }

        return (
          <>
            {invited.length > 0 && (
              <section style={{ marginBottom: 32 }}>
                <h2 style={styles.sectionHeading}>Pending invitations</h2>
                <ul style={styles.list}>
                  {invited.map((v) => (
                    <InvitedCard
                      key={v.id}
                      vault={v}
                      busy={busy}
                      onDone={() => { void load(); }}
                      setError={setError}
                      setBusy={setBusy}
                    />
                  ))}
                </ul>
              </section>
            )}

            {active.length > 0 && (
              <section>
                {invited.length > 0 && <h2 style={styles.sectionHeading}>Your vaults</h2>}
                <ul style={styles.list}>
                  {active.map((v) => (
                    <li key={v.id}>
                      <a href={`/dashboard/vaults/${v.id}`} style={styles.card}>
                        <div style={styles.cardTitle}>{v.name}</div>
                        <div style={styles.cardMeta}>
                          {v.owner_id === myUserId && <span style={styles.badge}>Owner</span>}
                          <span>{v.active_member_count} member{v.active_member_count === 1 ? '' : 's'}</span>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}
    </div>
  );
}

function InvitedCard({
  vault, busy, onDone, setError, setBusy,
}: {
  vault: Vault;
  busy: boolean;
  onDone: () => void;
  setError: (e: string) => void;
  setBusy: (b: boolean) => void;
}) {
  const call = async (action: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(true);
    try {
      await relay(`/vaults/${vault.id}/${action}`, { method: 'POST' });
      onDone();
    } catch (e) {
      setError(e instanceof RelayError ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <li>
      <div style={styles.invitedCard}>
        <div>
          <div style={styles.cardTitle}>{vault.name}</div>
          <div style={styles.cardMeta}>
            <span style={styles.invitedBadge}>Invited</span>
            <span>You&apos;ve been invited to collaborate.</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => call('decline')} disabled={busy} style={styles.secondaryBtn}>Decline</button>
          <button type="button" onClick={() => call('accept')} disabled={busy} style={styles.primaryBtn}>Accept</button>
        </div>
      </div>
    </li>
  );
}

const styles: Record<string, React.CSSProperties> = {
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: THEME.textBright,
    fontFamily: 'Georgia, serif',
  },
  primaryBtn: {
    padding: '8px 14px',
    background: THEME.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '8px 14px',
    background: THEME.surface,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  },
  linkBtn: {
    padding: '8px 6px',
    background: 'transparent',
    color: THEME.textMuted,
    border: 'none',
    fontSize: 13,
    cursor: 'pointer',
  },
  inlineForm: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: 14,
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    marginBottom: 24,
  },
  input: {
    flex: 1,
    padding: '8px 10px',
    background: THEME.bg,
    color: THEME.textBright,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
  },
  error: {
    padding: '10px 14px',
    background: 'rgba(244,114,182,0.08)',
    border: `1px solid ${THEME.pink}`,
    color: THEME.pink,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 16,
  },
  muted: { color: THEME.textMuted, fontSize: 13 },
  empty: {
    padding: '40px 24px',
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    textAlign: 'center',
  },
  list: { listStyle: 'none' },
  card: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 18px',
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    marginBottom: 10,
    textDecoration: 'none',
    color: THEME.text,
    transition: 'background 0.12s, border-color 0.12s',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 500,
    color: THEME.textBright,
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: THEME.textMuted,
  },
  badge: {
    padding: '2px 8px',
    background: THEME.accentSoft,
    color: THEME.link,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 500,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: 600,
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  invitedCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 18px',
    background: THEME.surface,
    border: `1px solid ${THEME.link}`,
    borderRadius: 8,
    marginBottom: 10,
    gap: 16,
  },
  invitedBadge: {
    padding: '2px 8px',
    background: 'rgba(167,139,250,0.14)',
    color: THEME.link,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 500,
  },
};
