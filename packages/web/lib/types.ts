// Two membership states today:
//  - 'active' : fully joined; syncs content.
//  - 'invited': pending accept; can see the vault exists but cannot sync.
// Relay's WS auth (packages/server/src/index.ts) gates on status='active'.
// 'pending_signup' represents pending_invites rows — someone invited by email
// who hasn't created a FreeSync account yet. They have no user_id yet, only
// the email; a trigger promotes them to vault_members when they sign up.
export type MembershipStatus = 'active' | 'invited' | 'pending_signup';

// Shape returned by GET /vaults. Includes both status values; the UI splits
// them into "Your vaults" and "Pending invitations". `vault_members` here
// is filtered to the caller only (one row), useful for reading own status;
// `active_member_count` is the real total for display.
export interface Vault {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  open_invite: boolean | null;
  created_at: string;
  updated_at?: string;
  vault_members: Array<{ user_id: string; status: MembershipStatus }>;
  active_member_count: number;
}

// Shape returned by GET /vaults/:id/members. Owner sees pending invitees too.
// Rows with status='pending_signup' have user_id=null (they haven't created
// an auth account yet); email is populated instead so the UI can show them.
export interface VaultMember {
  user_id: string | null;
  status: MembershipStatus;
  joined_at: string | null;
  email: string | null;
  profiles: {
    display_name: string | null;
    color: string | null;
  } | null;
}

// POST /vaults/:id/invite response variants.
export type InviteResult =
  | { invited: true; signup_required: false; already?: 'invited' }
  | { invited: true; signup_required: true }
  | { invited: false; already: 'member'; signup_required: false };
