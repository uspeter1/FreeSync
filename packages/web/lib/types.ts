// Shape returned by GET /vaults (`vaults` row joined with vault_members
// filtered to the caller). Fields match the DB columns the relay actually
// selects — see packages/server/src/index.ts GET /vaults handler.
export interface Vault {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  open_invite: boolean | null;
  created_at: string;
  updated_at?: string;
  vault_members: Array<{ user_id: string; status: string }>;
}

// Shape returned by GET /vaults/:id/members.
export interface VaultMember {
  user_id: string;
  status: string;
  joined_at: string;
  profiles: {
    display_name: string | null;
    color: string | null;
  } | null;
}

export type InviteResult =
  | { invited: true; signup_required: false }
  | { invited: true; signup_required: true };
