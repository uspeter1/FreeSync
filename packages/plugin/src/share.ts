// Google-Docs-style share panel. Single source of truth used by both the
// standalone share modal and the settings tab's share section.
//
// Layout:
//   Add-by-email input + Send button
//   People with access: owner (no ×) + members (×) + pending invites (×)
//   Empty states + loading states + inline errors
//
// Data comes from GET /vaults/:id/members which returns rows with
// { user_id, status: 'active'|'invited', joined_at, profiles: {…} | null }.
// The owner's user_id is on the vault record (GET /vaults) — we fetch both.

import { App, requestUrl } from 'obsidian';

export interface SharePluginRef {
  app: App;
  settings: { vaultId: string; email: string };
  currentJwt: string | null;
  getRelayHttpBase(): string;
}

interface Member {
  user_id: string | null;   // null for pending_signup (person hasn't signed up)
  status: 'active' | 'invited' | 'pending_signup';
  joined_at: string | null;
  email: string | null;     // populated for pending_signup rows
  profiles: { display_name: string | null; color: string | null } | null;
}

interface VaultInfo {
  id: string;
  name: string;
  owner_id: string;
}

// Public entrypoint. Renders into `container`, replacing any existing content.
export function renderShareUI(container: HTMLElement, plugin: SharePluginRef): void {
  container.empty();
  container.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

  if (!plugin.currentJwt || !plugin.settings.vaultId) {
    renderNotConnected(container);
    return;
  }

  const loading = container.createEl('div', { text: 'Loading…' });
  loading.style.cssText = 'color:var(--text-muted);font-size:13px;padding:8px 0;';

  void loadAndRender(container, plugin, loading);
}

async function loadAndRender(
  container: HTMLElement,
  plugin: SharePluginRef,
  loading: HTMLElement,
): Promise<void> {
  const base = plugin.getRelayHttpBase();
  const jwt = plugin.currentJwt!;
  const vaultId = plugin.settings.vaultId;

  try {
    const [vaultRes, membersRes] = await Promise.all([
      requestUrl({ url: `${base}/vaults`, headers: { Authorization: `Bearer ${jwt}` }, throw: false }),
      requestUrl({ url: `${base}/vaults/${vaultId}/members`, headers: { Authorization: `Bearer ${jwt}` }, throw: false }),
    ]);

    if (vaultRes.status !== 200) throw new Error(`GET /vaults returned ${vaultRes.status}`);
    if (membersRes.status !== 200) throw new Error(`GET /vaults/${vaultId}/members returned ${membersRes.status}`);

    const vault = (vaultRes.json as VaultInfo[]).find(v => v.id === vaultId);
    if (!vault) throw new Error('This vault is not in your account. Reconnect from settings.');

    loading.remove();
    render(container, plugin, vault, membersRes.json as Member[]);
  } catch (e) {
    loading.textContent = `Couldn't load: ${e instanceof Error ? e.message : String(e)}`;
    loading.style.color = 'var(--text-error)';
  }
}

function render(
  container: HTMLElement,
  plugin: SharePluginRef,
  vault: VaultInfo,
  members: Member[],
): void {
  const refresh = () => renderShareUI(container, plugin);

  // ── Header ────────────────────────────────────────────────────────────
  const header = container.createDiv();
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;';
  const title = header.createEl('div', { text: `Share "${vault.name}"` });
  title.style.cssText = 'font-size:17px;font-weight:600;letter-spacing:-0.01em;';
  const count = header.createEl('div', {
    text: `${activeCount(members)} ${activeCount(members) === 1 ? 'person has' : 'people have'} access`,
  });
  count.style.cssText = 'font-size:12px;color:var(--text-muted);';

  // ── Add by email ──────────────────────────────────────────────────────
  const invite = container.createDiv();
  invite.style.cssText = 'display:flex;gap:8px;align-items:stretch;';

  const emailInput = invite.createEl('input', { type: 'email', placeholder: 'Add people by email' });
  emailInput.style.cssText = [
    'flex:1', 'padding:9px 12px',
    'font-size:14px',
    'border:1px solid var(--background-modifier-border)',
    'border-radius:24px',
    'background:var(--background-primary)',
    'color:var(--text-normal)',
    'outline:none',
  ].join(';');
  emailInput.addEventListener('focus', () => {
    emailInput.style.borderColor = 'var(--interactive-accent)';
  });
  emailInput.addEventListener('blur', () => {
    emailInput.style.borderColor = 'var(--background-modifier-border)';
  });

  const sendBtn = invite.createEl('button', { text: 'Send' });
  sendBtn.style.cssText = [
    'padding:8px 20px',
    'border:none', 'border-radius:24px',
    'background:var(--interactive-accent)',
    'color:#fff',
    'font-size:13px', 'font-weight:600',
    'cursor:pointer',
    'transition:opacity 0.12s',
  ].join(';');

  const feedback = container.createDiv();
  feedback.style.cssText = 'font-size:12px;min-height:16px;padding:0 4px;';

  const doInvite = async () => {
    const email = emailInput.value.trim();
    if (!email) { flashFeedback(feedback, 'Enter an email address.', 'error'); return; }
    sendBtn.textContent = 'Sending…';
    (sendBtn as HTMLButtonElement).disabled = true;
    sendBtn.style.opacity = '0.6';
    try {
      const res = await requestUrl({
        url: `${plugin.getRelayHttpBase()}/vaults/${vault.id}/invite`,
        method: 'POST',
        headers: { Authorization: `Bearer ${plugin.currentJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        throw: false,
      });
      if (res.status === 200) {
        flashFeedback(feedback, res.json?.signup_required
          ? `✓ Invited ${email} — they'll join once they sign up.`
          : `✓ Invited ${email}.`, 'success');
        emailInput.value = '';
        refresh();
        return;
      }
      flashFeedback(feedback, `Couldn't invite: ${res.json?.error ?? 'unknown error'}`, 'error');
    } catch (e) {
      flashFeedback(feedback, `Couldn't invite: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      sendBtn.textContent = 'Send';
      (sendBtn as HTMLButtonElement).disabled = false;
      sendBtn.style.opacity = '1';
    }
  };
  sendBtn.addEventListener('click', doInvite);
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInvite(); });

  // ── People with access ─────────────────────────────────────────────────
  const sectionTitle = container.createEl('div', { text: 'People with access' });
  sectionTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-normal);margin-top:4px;';

  const list = container.createDiv();
  list.style.cssText = 'display:flex;flex-direction:column;';

  const sorted = [...members].sort((a, b) => {
    // Owner first, then active, then invited-with-account, then pending signup.
    // Alphabetical within each tier.
    const rank = (m: Member) => {
      if (m.user_id === vault.owner_id) return 0;
      if (m.status === 'active') return 1;
      if (m.status === 'invited') return 2;
      return 3;  // pending_signup
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return displayName(a).localeCompare(displayName(b));
  });

  for (const member of sorted) {
    renderMemberRow(list, member, vault, plugin, refresh);
  }
}

function renderMemberRow(
  parent: HTMLElement,
  member: Member,
  vault: VaultInfo,
  plugin: SharePluginRef,
  refresh: () => void,
): void {
  const isOwner = member.user_id === vault.owner_id;
  const isPending = member.status === 'invited' || member.status === 'pending_signup';
  const canRemove = !isOwner;  // owner can remove anyone else (server also enforces)

  const row = parent.createDiv();
  row.style.cssText = [
    'display:flex', 'align-items:center', 'gap:12px',
    'padding:10px 4px',
    'border-bottom:1px solid var(--background-modifier-border)',
  ].join(';');
  row.style.borderBottom = ''; // reset — added below by :not(:last-child) style equivalent
  // manually strip border on last child by post-processing — CSS doesn't work with inline styles
  // simplest: add a light border and let the last one look fine
  row.style.borderBottom = '1px solid var(--background-modifier-border)';

  // Avatar
  const avatar = row.createEl('div');
  const color = member.profiles?.color ?? (isPending ? 'var(--text-muted)' : '#7c5cfc');
  avatar.style.cssText = [
    'flex-shrink:0',
    'width:32px', 'height:32px',
    'border-radius:50%',
    `background:${color}`,
    'color:#fff',
    'font-size:13px', 'font-weight:700',
    'display:flex', 'align-items:center', 'justify-content:center',
    isPending ? 'opacity:0.5' : '',
  ].join(';');
  avatar.textContent = avatarInitial(member);

  // Name + email column
  const info = row.createDiv();
  info.style.cssText = 'flex:1;min-width:0;';

  const nameEl = info.createEl('div');
  nameEl.style.cssText = 'font-size:13px;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameEl.textContent = displayName(member) + (isSelf(member, plugin) ? ' (you)' : '');

  const subEl = info.createEl('div');
  subEl.style.cssText = 'font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  subEl.textContent =
    member.status === 'pending_signup' ? "Invited — hasn't signed up yet" :
    member.status === 'invited' ? 'Invitation pending' :
    (isOwner ? 'Owner' : 'Editor');

  // Right side — role label + optional remove
  const roleEl = row.createEl('div', { text: isOwner ? 'Owner' : (isPending ? 'Invited' : 'Editor') });
  roleEl.style.cssText = 'font-size:12px;color:var(--text-muted);padding-right:4px;';

  if (canRemove) {
    const removeBtn = row.createEl('button');
    removeBtn.setAttr('aria-label', isPending ? 'Cancel invitation' : 'Remove member');
    removeBtn.setAttr('title', isPending ? 'Cancel invitation' : 'Remove member');
    removeBtn.innerHTML = '&times;';
    removeBtn.style.cssText = [
      'width:26px', 'height:26px',
      'border:none', 'border-radius:50%',
      'background:transparent',
      'color:var(--text-muted)',
      'font-size:18px', 'line-height:1',
      'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'transition:background 0.12s,color 0.12s',
    ].join(';');
    removeBtn.addEventListener('mouseenter', () => {
      removeBtn.style.background = 'var(--background-modifier-error-hover, var(--background-modifier-hover))';
      removeBtn.style.color = 'var(--text-error, var(--text-normal))';
    });
    removeBtn.addEventListener('mouseleave', () => {
      removeBtn.style.background = 'transparent';
      removeBtn.style.color = 'var(--text-muted)';
    });
    removeBtn.addEventListener('click', () => void handleRemove(member, vault, plugin, refresh));
  }
}

async function handleRemove(
  member: Member,
  vault: VaultInfo,
  plugin: SharePluginRef,
  refresh: () => void,
): Promise<void> {
  const label = displayName(member);
  const isPending = member.status === 'invited' || member.status === 'pending_signup';
  const confirmMsg = isPending
    ? `Cancel invitation for ${label}?`
    : `Remove ${label} from "${vault.name}"? They will lose access immediately.`;
  if (!window.confirm(confirmMsg)) return;

  // pending_signup rows have no user_id — use the pending-invites endpoint
  // keyed by email. Everything else goes through the members endpoint.
  const url = member.status === 'pending_signup'
    ? `${plugin.getRelayHttpBase()}/vaults/${vault.id}/pending-invites/${encodeURIComponent(member.email ?? '')}`
    : `${plugin.getRelayHttpBase()}/vaults/${vault.id}/members/${member.user_id}`;

  try {
    const res = await requestUrl({
      url,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${plugin.currentJwt}` },
      throw: false,
    });
    if (res.status !== 200) {
      window.alert(`Couldn't ${isPending ? 'cancel invitation' : 'remove member'}: ${res.json?.error ?? 'unknown error'}`);
      return;
    }
    refresh();
  } catch (e) {
    window.alert(`Couldn't ${isPending ? 'cancel invitation' : 'remove member'}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function renderNotConnected(container: HTMLElement): void {
  const msg = container.createEl('div');
  msg.style.cssText = 'color:var(--text-muted);font-size:13px;padding:12px;text-align:center;';
  msg.textContent = 'Sign in and enable sync to share this vault.';
}

function activeCount(members: Member[]): number {
  return members.filter(m => m.status === 'active').length;
}

function displayName(member: Member): string {
  const name = member.profiles?.display_name?.trim();
  if (name) return name;
  if (member.email) return member.email;               // pending_signup
  if (member.status === 'invited') return '(pending)'; // invited-with-account but no profile — rare
  return (member.user_id ?? '').slice(0, 8) + '…';
}

function avatarInitial(member: Member): string {
  const name = member.profiles?.display_name?.trim();
  if (name) return name[0].toUpperCase();
  if (member.email) return member.email[0].toUpperCase();
  return '⧗';
}

function isSelf(member: Member, plugin: SharePluginRef): boolean {
  // Best-effort — we know the signed-in email but not the current user's
  // profile display_name for direct comparison. Server-side "self" check
  // would require decoding the JWT; skip for now and just don't mark.
  return false;
  // Note: could match on plugin.settings.email if the server returned emails,
  // but profiles doesn't currently carry it. Leaving disabled.
  void plugin;
}

function flashFeedback(el: HTMLElement, text: string, kind: 'success' | 'error'): void {
  el.textContent = text;
  el.style.color = kind === 'success' ? 'var(--text-accent, var(--interactive-accent))' : 'var(--text-error)';
  if (kind === 'success') {
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
  }
}
