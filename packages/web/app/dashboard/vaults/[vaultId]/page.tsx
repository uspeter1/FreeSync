'use client';

import { useEffect, useState, use } from 'react';
import { relay, RelayError } from '@/lib/relay';
import type { Vault, VaultMember, InviteResult } from '@/lib/types';
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
  const activeCount = members.filter((m) => m.status === 'active').length;

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

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || busy) return;
    const target = inviteEmail.trim();
    setBusy(true);
    setInviteFlash(null);
    try {
      const r = await relay<InviteResult>(`/vaults/${vaultId}/invite`, {
        method: 'POST', body: { email: target },
      });
      let msg: string;
      if (r.invited && r.signup_required) msg = `Invite sent to ${target}. They'll see it after signing up.`;
      else if (r.invited && r.already === 'invited') msg = `${target} was already invited — no new notification sent.`;
      else if (r.invited) msg = `Invited ${target}.`;
      else msg = `${target} is already a member of this vault.`;
      setInviteFlash(msg);
      setInviteEmail('');
      await load();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const removeMember = async (member: VaultMember, displayName: string) => {
    const isPendingSignup = member.status === 'pending_signup';
    const label = isPendingSignup ? 'Cancel invitation' : (member.status === 'invited' ? 'Cancel invitation' : 'Remove');
    if (!confirm(
      isPendingSignup || member.status === 'invited'
        ? `Cancel invitation for ${displayName}?`
        : `Remove ${displayName} from this vault? They will lose access immediately.`
    )) return;
    setBusy(true);
    try {
      const url = isPendingSignup
        ? `/vaults/${vaultId}/pending-invites/${encodeURIComponent(member.email ?? '')}`
        : `/vaults/${vaultId}/members/${member.user_id}`;
      await relay(url, { method: 'DELETE' });
      await load();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
    void label; // silence
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

  const sortedMembers = [...members].sort((a, b) => {
    const rank = (m: VaultMember) => {
      if (m.user_id === vault.owner_id) return 0;
      if (m.status === 'active') return 1;
      if (m.status === 'invited') return 2;
      return 3; // pending_signup
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return displayName(a).localeCompare(displayName(b));
  });

  return (
    <div>
      <a href="/dashboard" style={styles.back}>← All vaults</a>

      {/* Title + inline rename */}
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
      <div style={styles.subtle}>
        {activeCount} {activeCount === 1 ? 'person has' : 'people have'} access
      </div>

      <a href={`/dashboard/vaults/${vault.id}/browse`} style={styles.browseLink}>
        Browse files →
      </a>

      {error && <div style={styles.error}>{error}</div>}

      {/* People with access — email invite on top, then combined list */}
      <Section title="People with access">
        {isOwner ? (
          <form onSubmit={invite} style={styles.inviteRow}>
            <input
              type="email"
              placeholder="Add people by email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={styles.pillInput}
            />
            <button type="submit" disabled={busy || !inviteEmail.trim()} style={styles.pillBtn}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </form>
        ) : (
          <div style={{ ...styles.subtle, marginBottom: 20 }}>
            Only the vault owner can invite people.
          </div>
        )}
        {inviteFlash && <div style={styles.success}>{inviteFlash}</div>}

        <ul style={styles.memberList}>
          {sortedMembers.map((m) => (
            <MemberRow
              key={memberKey(m)}
              m={m}
              vault={vault}
              myUserId={myUserId}
              isOwner={isOwner}
              onRemove={removeMember}
            />
          ))}
        </ul>
      </Section>

      <Section title="Danger zone" tone="danger">
        {!isOwner && (
          <div>
            <div style={styles.subtle}>Leaving removes your access. The vault stays for other members. You can rejoin if the owner invites you again.</div>
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
        <ConfirmModal title="Leave vault?" onCancel={() => setShowLeave(false)}>
          <p style={{ marginBottom: 16 }}>
            You&apos;ll lose access to <strong>{vault.name}</strong>. Other members keep working normally.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowLeave(false)} style={styles.secondaryBtn}>Cancel</button>
            <button type="button" onClick={doLeave} disabled={busy} style={styles.dangerBtn}>
              {busy ? 'Leaving…' : 'Leave vault'}
            </button>
          </div>
        </ConfirmModal>
      )}

      {showDelete && (
        <ConfirmModal title="Delete vault?" onCancel={() => { setShowDelete(false); setDeleteConfirm(''); }}>
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

function MemberRow({
  m, vault, myUserId, isOwner, onRemove,
}: {
  m: VaultMember;
  vault: Vault;
  myUserId: string | undefined;
  isOwner: boolean;
  onRemove: (m: VaultMember, displayName: string) => void;
}) {
  const name = displayName(m);
  const color = m.profiles?.color ?? THEME.accent;
  const initial = avatarInitial(m);
  const isSelf = m.user_id != null && m.user_id === myUserId;
  const isOwnerRow = m.user_id === vault.owner_id;
  const isPending = m.status === 'invited' || m.status === 'pending_signup';
  const canRemove = isOwner && !isOwnerRow;

  const roleLabel =
    isOwnerRow ? 'Owner' :
    m.status === 'active' ? 'Editor' :
    'Invited';

  const subtitle =
    m.status === 'pending_signup' ? "Invited — hasn't signed up yet" :
    m.status === 'invited' ? 'Invitation pending' :
    (isOwnerRow ? 'Owner' : 'Editor');

  return (
    <li style={styles.memberRow}>
      <div style={{
        ...styles.memberAvatar,
        background: color,
        opacity: isPending ? 0.55 : 1,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.memberName}>
          {name}{isSelf && <span style={{ color: THEME.textMuted }}> (you)</span>}
        </div>
        <div style={styles.subtle}>{subtitle}</div>
      </div>
      <div style={styles.roleLabel}>{roleLabel}</div>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(m, name)}
          style={styles.removeBtn}
          title={isPending ? 'Cancel invitation' : 'Remove member'}
          aria-label={isPending ? 'Cancel invitation' : 'Remove member'}
        >
          ×
        </button>
      )}
    </li>
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

function displayName(m: VaultMember): string {
  const n = m.profiles?.display_name?.trim();
  if (n) return n;
  if (m.email) return m.email;
  if (m.status === 'invited') return '(pending)';
  return (m.user_id ?? '').slice(0, 8) + '…';
}

function avatarInitial(m: VaultMember): string {
  const n = m.profiles?.display_name?.trim();
  if (n) return n[0].toUpperCase();
  if (m.email) return m.email[0].toUpperCase();
  return '⧗';
}

function memberKey(m: VaultMember): string {
  return m.user_id ?? `pending:${m.email ?? Math.random()}`;
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
    marginBottom: 4,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: THEME.textBright,
    fontFamily: 'Georgia, serif',
  },
  section: {
    padding: 24,
    marginTop: 20,
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
  subtle: { fontSize: 12, color: THEME.textMuted, marginTop: 2 },
  browseLink: {
    display: 'inline-block',
    marginTop: 10,
    fontSize: 13,
    color: THEME.link,
    textDecoration: 'none',
    fontWeight: 500,
  },
  inviteRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 20,
  },
  pillInput: {
    flex: 1,
    padding: '10px 16px',
    background: THEME.bg,
    color: THEME.textBright,
    border: `1px solid ${THEME.border}`,
    borderRadius: 999,
    fontSize: 14,
    outline: 'none',
  },
  pillBtn: {
    padding: '10px 24px',
    background: THEME.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  memberList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: `1px solid ${THEME.border}`,
  },
  memberAvatar: {
    flexShrink: 0,
    width: 34,
    height: 34,
    borderRadius: '50%',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    fontSize: 13,
    color: THEME.textBright,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  roleLabel: {
    fontSize: 12,
    color: THEME.textMuted,
    padding: '0 12px 0 8px',
    flexShrink: 0,
  },
  removeBtn: {
    width: 26,
    height: 26,
    padding: 0,
    background: 'transparent',
    color: THEME.textMuted,
    border: 'none',
    borderRadius: '50%',
    fontSize: 20,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  error: {
    padding: '10px 14px',
    background: 'rgba(244,114,182,0.08)',
    border: `1px solid ${THEME.pink}`,
    color: THEME.pink,
    borderRadius: 6,
    fontSize: 13,
    marginTop: 16,
  },
  success: {
    padding: '10px 14px',
    background: 'rgba(74,222,128,0.08)',
    border: `1px solid ${THEME.green}`,
    color: THEME.green,
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 16,
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
