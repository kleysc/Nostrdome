// Types for live community state (kinds 39000-39101 reconstructed).
// Kept separate from store.ts to avoid cycles when components import only
// the types.

export interface CommunityMetadata {
  groupId: string;
  name: string;
  picture?: string;
  about?: string;
  ownerPubkey: string;
}

export interface AdminEntry {
  pubkey: string;
  permissions: string[];
}

export interface MemberEntry {
  pubkey: string;
  roleIds: string[];
  joinedAt: number;
  displayOverride?: string;
  pictureOverride?: string;
}

export interface RoleDef {
  id: string;
  name: string;
  color: string;
  badge?: string;
  permissions: string[];
  priority: number;
}

export interface CategoryDef {
  id: string;
  name: string;
  position: number;
}

export interface ChannelDef {
  id: string;
  name: string;
  categoryId?: string;
  type: 'text' | 'voice' | 'encrypted' | 'announcement';
  topic?: string;
  position: number;
  writeRoles: string[];
  readRoles: string[];
}

export interface LiveCommunityState {
  metadata: CommunityMetadata | null;
  admins: AdminEntry[];
  members: MemberEntry[];
  roles: RoleDef[];
  categories: CategoryDef[];
  channels: ChannelDef[];
}

export type LiveStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'subscribing'
  | 'ready'
  | 'error';

export const emptyLiveCommunity: LiveCommunityState = {
  metadata: null,
  admins: [],
  members: [],
  roles: [],
  categories: [],
  channels: [],
};

// Permission helpers (kept small; full matrix lives in spec).

export function memberHasPermission(
  state: LiveCommunityState,
  pubkey: string,
  permission: string,
): boolean {
  const member = state.members.find((m) => m.pubkey === pubkey);
  if (!member) return false;
  const roleSet = new Set(member.roleIds);
  return state.roles.some(
    (r) => roleSet.has(r.id) && r.permissions.includes(permission),
  );
}

export function memberRoleIds(state: LiveCommunityState, pubkey: string): string[] {
  return state.members.find((m) => m.pubkey === pubkey)?.roleIds ?? [];
}

export function canReadChannel(
  state: LiveCommunityState,
  pubkey: string,
  channel: ChannelDef,
): boolean {
  const roles = new Set([...memberRoleIds(state, pubkey), 'everyone']);
  return channel.readRoles.some((r) => roles.has(r));
}

// ── Profile + presence (§1.5) ───────────────────────────────────────────────

// Subset of NIP-01 kind 0 we actually render. Other fields are tolerated but
// dropped on parse.
export interface Kind0Profile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

// `lastSeen` is the unix-seconds timestamp of the last heartbeat we saw.
// Online derived as `Date.now()/1000 - lastSeen < ONLINE_WINDOW_SEC`.
export const PRESENCE_HEARTBEAT_SEC = 30;
export const PRESENCE_ONLINE_WINDOW_SEC = 90;
export const PRESENCE_KIND = 21000;

// Returns the member's highest-priority role from a state. Used to bucketize
// the member sidebar. Falls back to a synthetic "members" role when the user
// has no role mapped (shouldn't happen for live data but keeps the UI safe).
export function memberHighestRole(
  state: LiveCommunityState,
  pubkey: string,
): RoleDef | null {
  const ids = new Set(memberRoleIds(state, pubkey));
  if (!ids.size) return null;
  let best: RoleDef | null = null;
  for (const r of state.roles) {
    if (!ids.has(r.id)) continue;
    if (!best || r.priority > best.priority) best = r;
  }
  return best;
}

// Display name resolution priority: per-server override > kind 0 display_name
// > kind 0 name > truncated npub-like fallback (caller supplies fallback).
export function resolveMemberDisplay(
  member: MemberEntry,
  profile: Kind0Profile | undefined,
  fallback: string,
): string {
  return (
    member.displayOverride?.trim()
    || profile?.display_name?.trim()
    || profile?.name?.trim()
    || fallback
  );
}

export function resolveMemberPicture(
  member: MemberEntry,
  profile: Kind0Profile | undefined,
): string | undefined {
  return member.pictureOverride || profile?.picture;
}
