'use client';

import { useEffect, useState, use } from 'react';
import { relay, RelayError } from '@/lib/relay';
import type { Vault, VaultMember } from '@/lib/types';
import { THEME } from '@/components/theme';
import { useSession } from '@/lib/session';

interface Props {
  params: Promise<{ vaultId: string }>;
}

export default function VaultDetail({ params }: Props) {
  const { vaultId } = use(params);
  const sessionState = useSession();
  const myUserId = !sessionState.loading ? sessionState.session?.user.id : undefined;

  const [vault, setVault] = useState<Vault | null>(null);
  const [members, setMembers] = useState<VaultMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFlash, setInviteFlash] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showLeave, setShowLeave] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [vaults, memberList] = await Promise.all([
        relay<Vault[]>('/vaults'),
        relay<VaultMember[]>(`/vaults/${vaultId}/members`),
      ]);
      const v = vaults.find((x) => x.id === vaultId);
      if (!v) { setError('Vault not found or you are no longer a member.'); return; }
      setVault(v);
      setMembers(memberList);
    } catch (e) {
      setError(e instanceof RelayError ? e.message : String(e));
    }
  };

  useEffect(() => { void load(); }, [vaultId]);

  if (error && !vault) return <ErrorPanel error={error} />;
  if (!vault || !members) return <div style={{ color: THEME.textMuted, fontSize: 13 }}>Loading…</div>;

  const isOwner = vault.owner_id === myUserId;
  const shareCode = `${vault.id}/${vault.invite_code}`;

  const saveName = async () => {
    if (!nameDraft.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await relay<Vault>(`/vaults/${vaultId}`, { method: 'PATCH', body: { name: nameDraft.trim() } });
      setVault({ ...vault, name: updated.name });
      setEditingName(false);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const toggleOpenInvite = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await relay(`/vaults/${vaultId}/open-invite`, { method: 'PATCH', body: { enabled } });
      setVault({ ...vault, open_invite: enabled });
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const rotateCode = async () => {
    if (busy) return;
    if (!confirm('Rotate the invite code? Anyone using the old code will no longer be able to join.')) return;
    setBusy(true);
    try {
      const { invite_code } = await relay<{ invite_code: string }>(`/vaults/${vaultId}/rotate-invite-code`, { method: 'POST' });
      setVault({ ...vault, invite_code });
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || busy) return;
    setBusy(true);
    setInviteFlash(null);
    try {
      const r = await relay<{ invited: true; signup_required: boolean }>(`/vaults/${vaultId}/invite`, {
        method: 'POST', body: { email: inviteEmail.trim() },
      });
      setInviteFlash(r.signup_required
        ? `Invite sent to ${inviteEmail.trim()}. They'll be added when they sign up.`
        : `${inviteEmail.trim()} has been added.`);
      setInviteEmail('');
      await load();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const removeMember = async (memberId: string, displayName: string) => {
    if (!confirm(`Remove ${displayName} from this vault?`)) return;
    setBusy(true);
    try {
      await relay(`/vaults/${vaultId}/members/${memberId}`, { method: 'DELETE' });
      setMembers(members.filter((m) => m.user_id !== memberId));
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doLeave = async () => {
    setBusy(true);
    try {
      await relay(`/vaults/${vaultId}/leave`, { method: 'POST' });
      window.location.href = '/dashboard';
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  const doDelete = async () => {
    if (deleteConfirm !== vault.name) return;
    setBusy(true);
    try {
      await relay(`/vaults/${vaultId}`, { method: 'DELETE' });
      window.location.href = '/dashboard';
    } catch (e) { setError(errMsg(e)); setBusy(false); }
  };

  return (
    <div>
      <a href="/dashboard" style={styles.back}>← All vaults</a>

      <div style={styles.titleRow}>
        {!editingName ? (
          <>
            <h1 style={styles.pageTitle}>{vault.name}</h1>
            {isOwner && (
              <button
                type="button"
                onClick={() => { setNameDraft(vault.name); setEditingName(true); }}
                style={styles.linkBtn}
              >
                Rename
              </button>
            )}
          </>
        ) : (
          <>
            <input
              autoFocus
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setEditingName(false); }}
              style={{ ...styles.input, fontSize: 22, fontWeight: 600, maxWidth: 400 }}
            />
            <button type="button" onClick={saveName} disabled={busy || !nameDraft.trim()} style={styles.primaryBtn}>Save</button>
            <button type="button" onClick={() => setEditingName(false)} style={styles.linkBtn}>Cancel</button>
          </>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <Section title="Members">
        <ul style={styles.memberList}>
          {members.map((m) => {
            const name = m.profiles?.display_name ?? m.user_id.slice(0, 8);
            const color = m.profiles?.color ?? THEME.accent;
            const initials = (name[0] ?? '?').toUpperCase();
            const isSelf = m.user_id === myUserId;
            const isOwnerRow = m.user_id === vault.owner_id;
            return (
              <li key={m.user_id} style={styles.memberRow}>
                <div style={{ ...styles.memberAvatar, background: color }}>{initials}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: THEME.textBright, fontSize: 13 }}>
                    {name}
                    {isSelf && <span style={styles.subtle}> (you)</span>}
                    {isOwnerRow && <span style={styles.badge}>Owner</span>}
                  </div>
                  <div style={styles.subtle}>Joined {new Date(m.joined_at).toLocaleDateString()}</div>
                </div>
                {isOwner && !isOwnerRow && (
                  <button type="button" onClick={() => removeMember(m.user_id, name)} style={styles.dangerLinkBtn}>Remove</button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Invite people">
        {isOwner && (
          <form onSubmit={invite} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
            <button type="submit" disabled={busy || !inviteEmail.trim()} style={styles.primaryBtn}>Invite</button>
          </form>
        )}
        {!isOwner && <div style={{ ...styles.subtle, marginBottom: 20 }}>Only the vault owner can invite people by email.</div>}
        {inviteFlash && <div style={styles.success}>{inviteFlash}</div>}

        <div style={styles.subSection}>
          <div style={styles.subTitle}>Invite by code</div>
          <div style={styles.subtle}>
            {vault.open_invite
              ? 'Anyone with this code can join. Rotate the code if it leaks.'
              : 'Code sharing is off. Turn it on to let people join with just the code.'}
          </div>
          <div style={{ ...styles.codeBox, opacity: vault.open_invite ? 1 : 0.4 }}>
            {shareCode}
            <button type="button" onClick={() => navigator.clipboard.writeText(shareCode)} style={styles.copyBtn} disabled={!vault.open_invite}>Copy</button>
          </div>
          {isOwner && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => toggleOpenInvite(!vault.open_invite)}
                disabled={busy}
                style={vault.open_invite ? styles.secondaryBtn : styles.primaryBtn}
              >
                {vault.open_invite ? 'Disable code sharing' : 'Enable code sharing'}
              </button>
              <button type="button" onClick={rotateCode} disabled={busy} style={styles.secondaryBtn}>Rotate code</button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Danger zone" tone="danger">
        {!isOwner && (
          <div>
            <div style={styles.subtle}>Leaving removes your access. The vault stays for other members. You can rejoin if the owner shares an invite.</div>
            <button type="button" onClick={() => setShowLeave(true)} style={{ ...styles.dangerBtn, marginTop: 12 }}>Leave vault</button>
          </div>
        )}
        {isOwner && (
          <div>
            <div style={styles.subtle}>Deleting a vault permanently removes it and all its content for every member. This cannot be undone.</div>
            <button type="button" onClick={() => setShowDelete(true)} style={{ ...styles.dangerBtn, marginTop: 12 }}>Delete vault</button>
          </div>
        )}
      </Section>

      {showLeave && (
        <ConfirmModal
          title="Leave vault?"
          onCancel={() => setShowLeave(false)}
        >
          <p style={{ marginBottom: 16 }}>
            You&apos;ll lose access to <strong>{vault.name}</strong>. Other members keep working normally.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowLeave(false)} style={styles.secondaryBtn}>Cancel</button>
            <button type="button" onClick={doLeave} disabled={busy} style={styles.dangerBtn}>{busy ? 'Leaving…' : 'Leave vault'}</button>
          </div>
        </ConfirmModal>
      )}

      {showDelete && (
        <ConfirmModal
          title="Delete vault?"
          onCancel={() => { setShowDelete(false); setDeleteConfirm(''); }}
        >
          <p style={{ marginBottom: 12 }}>
            This permanently deletes <strong>{vault.name}</strong> and all its content for every member. It cannot be undone.
          </p>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: THEME.textMuted }}>
            Type <strong style={{ color: THEME.textBright }}>{vault.name}</strong> to confirm:
          </label>
          <input
            autoFocus
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            style={{ ...styles.input, marginBottom: 16 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setShowDelete(false); setDeleteConfirm(''); }} style={styles.secondaryBtn}>Cancel</button>
            <button
              type="button"
              onClick={doDelete}
              disabled={busy || deleteConfirm !== vault.name}
              style={{ ...styles.dangerBtn, opacity: deleteConfirm === vault.name ? 1 : 0.4 }}
            >
              {busy ? 'Deleting…' : 'Delete vault'}
            </button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <section style={{
      ...styles.section,
      borderColor: tone === 'danger' ? THEME.pink : THEME.border,
    }}>
      <h2 style={{
        ...styles.sectionTitle,
        color: tone === 'danger' ? THEME.pink : THEME.textBright,
      }}>{title}</h2>
      {children}
    </section>
  );
}

function ConfirmModal({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div style={styles.modalScrim} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, marginBottom: 12, color: THEME.textBright }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ErrorPanel({ error }: { error: string }) {
  return (
    <div>
      <a href="/dashboard" style={styles.back}>← All vaults</a>
      <div style={styles.error}>{error}</div>
    </div>
  );
}

function errMsg(e: unknown): string {
  return e instanceof RelayError ? e.message : String(e);
}

const styles: Record<string, React.CSSProperties> = {
  back: {
    display: 'inline-block',
    marginBottom: 16,
    fontSize: 13,
    color: THEME.textMuted,
    textDecoration: 'none',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: THEME.textBright,
    fontFamily: 'Georgia, serif',
  },
  section: {
    padding: 24,
    marginBottom: 20,
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  subSection: { paddingTop: 8 },
  subTitle: { fontSize: 13, fontWeight: 500, color: THEME.textBright, marginBottom: 6 },
  subtle: { fontSize: 12, color: THEME.textMuted, marginTop: 6 },
  memberList: { listStyle: 'none' },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: `1px solid ${THEME.border}`,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    marginLeft: 8,
    padding: '2px 8px',
    background: THEME.accentSoft,
    color: THEME.link,
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 500,
    verticalAlign: 'middle',
  },
  codeBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '10px 14px',
    marginTop: 10,
    background: THEME.bg,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    fontFamily: '"Courier New", monospace',
    fontSize: 12,
    color: THEME.textBright,
    wordBreak: 'break-all',
  },
  copyBtn: {
    padding: '4px 10px',
    background: THEME.surface,
    color: THEME.text,
    border: `1px solid ${THEME.border}`,
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    flexShrink: 0,
  },
  input: {
    padding: '8px 10px',
    background: THEME.bg,
    color: THEME.textBright,
    border: `1px solid ${THEME.border}`,
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    width: '100%',
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
  dangerBtn: {
    padding: '8px 14px',
    background: THEME.pink,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  dangerLinkBtn: {
    padding: '6px 10px',
    background: 'transparent',
    color: THEME.pink,
    border: 'none',
    fontSize: 12,
    cursor: 'pointer',
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
  success: {
    padding: '10px 14px',
    background: 'rgba(74,222,128,0.08)',
    border: `1px solid ${THEME.green}`,
    color: THEME.green,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 12,
  },
  modalScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    background: THEME.surfaceHigh,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 24,
    minWidth: 400,
    maxWidth: 480,
    color: THEME.text,
    fontSize: 13,
    lineHeight: 1.5,
  },
};
