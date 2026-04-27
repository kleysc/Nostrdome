// Pure helpers that turn (members, roles, presence, profiles) into the flat
// row list the virtualized member sidebar renders. Kept side-effect-free so
// it's trivial to test and to call from a useMemo without invalidating on
// every store tick.
import {
  memberHighestRole,
  resolveMemberDisplay,
  PRESENCE_ONLINE_WINDOW_SEC,
  type Kind0Profile,
  type LiveCommunityState,
  type MemberEntry,
  type RoleDef,
} from '../stores/community-types';

export interface HeaderRow {
  type: 'header';
  key: string;
  label: string;
  count: number;
  color?: string;
  badge?: string;
  // Tooltip shown on hover. Used for "permissions of this role".
  tooltip?: string;
}

export interface MemberItemRow {
  type: 'member';
  key: string;
  pubkey: string;
  member: MemberEntry;
  role: RoleDef | null;
  online: boolean;
  displayName: string;
  profile: Kind0Profile | undefined;
}

export type MemberRow = HeaderRow | MemberItemRow;

interface BuildArgs {
  state: LiveCommunityState;
  profiles: Record<string, Kind0Profile>;
  presence: Record<string, number>;
  /** unix-seconds. Pass via a ticking ref so "online" updates as time passes. */
  nowSec: number;
}

const SHORT_FALLBACK_LEN = 12;

function shortFallback(pubkey: string): string {
  return `${pubkey.slice(0, SHORT_FALLBACK_LEN)}…`;
}

function rolePermissionsTooltip(role: RoleDef): string {
  if (!role.permissions.length) return `${role.name} — sin permisos especiales`;
  return `${role.name} — ${role.permissions.join(', ')}`;
}

// Stable comparator: case-insensitive display name, then pubkey for tiebreak
// (deterministic ordering across renders even if names collide).
function compareMembers(a: MemberItemRow, b: MemberItemRow): number {
  const cmp = a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
  return cmp !== 0 ? cmp : a.pubkey.localeCompare(b.pubkey);
}

/**
 * Build the flat list of rows for the virtualized sidebar.
 *
 * Layout (Discord-equivalent):
 *   [role header (priority desc)]   ← online members of that role
 *     member
 *     member
 *   [role header next priority]
 *     member
 *   [Online — N]                     ← members with no role assigned
 *     member
 *   [Offline — N]                    ← all offline members in one bucket
 *     member
 *
 * Empty role groups are skipped. Offline group only appears if any offline.
 */
export function buildMemberRows({ state, profiles, presence, nowSec }: BuildArgs): MemberRow[] {
  const onlineByRole = new Map<string, MemberItemRow[]>();
  const onlineNoRole: MemberItemRow[] = [];
  const offline: MemberItemRow[] = [];

  for (const member of state.members) {
    const role = memberHighestRole(state, member.pubkey);
    const profile = profiles[member.pubkey];
    const displayName = resolveMemberDisplay(member, profile, shortFallback(member.pubkey));
    const lastSeen = presence[member.pubkey] ?? 0;
    const isOnline = nowSec - lastSeen < PRESENCE_ONLINE_WINDOW_SEC;

    const row: MemberItemRow = {
      type: 'member',
      key: `m:${member.pubkey}`,
      pubkey: member.pubkey,
      member,
      role,
      online: isOnline,
      displayName,
      profile,
    };

    if (!isOnline) {
      offline.push(row);
      continue;
    }
    if (role) {
      const bucket = onlineByRole.get(role.id) ?? [];
      bucket.push(row);
      onlineByRole.set(role.id, bucket);
    } else {
      onlineNoRole.push(row);
    }
  }

  // Roles already arrive sorted by priority desc from the store. Skip ones
  // that have no online members. We still want a deterministic order if two
  // roles share the same priority — fall back to id.
  const sortedRoles = [...state.roles].sort(
    (a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id),
  );

  const rows: MemberRow[] = [];

  for (const role of sortedRoles) {
    const members = onlineByRole.get(role.id);
    if (!members?.length) continue;
    members.sort(compareMembers);
    rows.push({
      type: 'header',
      key: `h:${role.id}`,
      label: role.name,
      count: members.length,
      color: role.color,
      badge: role.badge,
      tooltip: rolePermissionsTooltip(role),
    });
    rows.push(...members);
  }

  if (onlineNoRole.length) {
    onlineNoRole.sort(compareMembers);
    rows.push({
      type: 'header',
      key: 'h:__online__',
      label: 'Online',
      count: onlineNoRole.length,
    });
    rows.push(...onlineNoRole);
  }

  if (offline.length) {
    offline.sort(compareMembers);
    rows.push({
      type: 'header',
      key: 'h:__offline__',
      label: 'Offline',
      count: offline.length,
    });
    rows.push(...offline);
  }

  return rows;
}
