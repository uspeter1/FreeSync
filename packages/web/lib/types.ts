// Two membership states today:
//  - 'active' : fully joined; syncs content.
//  - 'invited': pending accept; can see the vault exists but cannot sync.
// Relay's WS auth (packages/server/src/index.ts) gates on status='active'.
export type MembershipStatus = 'active' | 'invited';

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
export interface VaultMember {
  user_id: string;
  status: MembershipStatus;
  joined_at: string;
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
