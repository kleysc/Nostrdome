// Single Zustand store for the app shell. Slices are split by concern;
// they all live in this file for now to avoid premature folder explosion.
// Real data (channels, members, chat messages) lands in §1.4 / §1.5 / §1.6.
import { create } from 'zustand';
import {
  emptyLiveCommunity,
  type Kind0Profile,
  type LiveCommunityState,
  type LiveStatus,
} from './community-types';

export type Theme = 'matrix' | 'cyberpunk' | 'midnight' | 'light';

const storedTheme = (typeof localStorage !== 'undefined'
  ? (localStorage.getItem('nostrdome_theme') as Theme | null)
  : null) ?? 'matrix';

const storedKey = (typeof localStorage !== 'undefined'
  ? localStorage.getItem('nostrPrivateKey')
  : null);

// ── Slice shapes ─────────────────────────────────────────────────────────────

interface AuthSlice {
  privateKey: string | null;
  publicKey: string | null;
  setKeys: (priv: string | null, pub: string | null) => void;
  logout: () => void;
}

interface UiSlice {
  theme: Theme;
  setTheme: (t: Theme) => void;
  isMemberSidebarOpen: boolean;
  toggleMemberSidebar: () => void;
  isMultiServerComingModalOpen: boolean;
  openComingModal: () => void;
  closeComingModal: () => void;
  // Selected member for the side panel. null = panel closed.
  selectedMemberPubkey: string | null;
  selectMember: (pubkey: string | null) => void;
}

interface CommunitySlice {
  // Active community is driven by the URL (`/c/:groupId`). Components that
  // can't infer the group from props (e.g. MemberSidebar, server bar)
  // resolve it via this field.
  activeGroupId: string | null;
  setActiveGroup: (id: string | null) => void;

  // Per-group projections (kinds 39000-39101 reconstructed). All maps are
  // keyed by groupId. Reading a missing key yields the fallback values
  // (emptyLiveCommunity / 'idle' / null) via the selector helpers below —
  // never index these maps directly from a component.
  communities: Record<string, LiveCommunityState>;
  liveStatus: Record<string, LiveStatus>;
  liveError: Record<string, string | null>;

  resetLive: (groupId: string) => void;
  applyLiveMetadata: (groupId: string, m: LiveCommunityState['metadata']) => void;
  applyLiveAdmins: (groupId: string, admins: LiveCommunityState['admins']) => void;
  applyLiveMembers: (groupId: string, members: LiveCommunityState['members']) => void;
  applyLiveRoles: (groupId: string, roles: LiveCommunityState['roles']) => void;
  upsertLiveCategory: (groupId: string, category: LiveCommunityState['categories'][number]) => void;
  upsertLiveChannel: (groupId: string, channel: LiveCommunityState['channels'][number]) => void;
  setLiveStatus: (groupId: string, s: LiveStatus, err?: string | null) => void;

  // Per-(user, group) collapsed-category state, persisted to localStorage.
  collapsedCategories: Record<string, boolean>;
  toggleCategoryCollapsed: (key: string) => void;
}

// Profile cache shared across the app. Keyed by pubkey (hex). Values are the
// parsed kind 0 metadata; absent key = not yet fetched.
interface MembersSlice {
  profiles: Record<string, Kind0Profile>;
  // Merge a single profile (last-write-wins by created_at handled by caller).
  setProfile: (pubkey: string, profile: Kind0Profile) => void;
  // Bulk merge — used by useMemberProfiles after EOSE to avoid render thrash.
  setProfiles: (entries: Array<{ pubkey: string; profile: Kind0Profile }>) => void;
}

// Presence is per-group: groupId → (pubkey → unix-seconds of last heartbeat).
// Two members with the same pubkey across two communities are independent
// presence facts (a user may be online in one and silent in another).
interface PresenceSlice {
  presence: Record<string, Record<string, number>>;
  setPresence: (groupId: string, pubkey: string, lastSeen: number) => void;
  resetPresence: (groupId: string) => void;
}

// Stubs — implemented when each task lands.
interface ChannelsSlice { /* §1.4 — covered above via live */ }

// §1.6: per-channel drafts + local mute list. Drafts are keyed by
// `${groupId}::${channelId}` so they survive channel switches and tab reloads.
// The mute list is global per user (no per-server scope yet — admin-published
// bans land in F5 via kind 39002 ban registry).
interface ChatSlice {
  drafts: Record<string, string>;
  setDraft: (groupId: string, channelId: string, value: string) => void;
  clearDraft: (groupId: string, channelId: string) => void;

  mutedPubkeys: string[];
  toggleMuted: (pubkey: string) => void;
}
interface VoiceSlice { /* F4 */ }
interface EncryptionSlice { /* F3 */ }

const DRAFTS_KEY = 'nostrdome_chat_drafts';
const MUTED_KEY = 'nostrdome_muted_pubkeys';

function draftKey(groupId: string, channelId: string): string {
  return `${groupId}::${channelId}`;
}

// mergeCommunity is the per-group equivalent of the old in-place spread on
// `state.live`. Lives at module scope so the slice actions stay one-liners.
// Uses emptyLiveCommunity as the seed so the first event for a brand-new
// group bootstraps the projection without ifs scattered through callers.
function mergeCommunity(
  state: { communities: Record<string, LiveCommunityState> },
  groupId: string,
  patch: (live: LiveCommunityState) => LiveCommunityState,
): { communities: Record<string, LiveCommunityState> } {
  const current = state.communities[groupId] ?? emptyLiveCommunity;
  return { communities: { ...state.communities, [groupId]: patch(current) } };
}

type State = AuthSlice & UiSlice & CommunitySlice
  & ChannelsSlice & MembersSlice & ChatSlice
  & PresenceSlice & VoiceSlice & EncryptionSlice;

// ── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<State>((set) => ({
  // auth
  privateKey: storedKey,
  publicKey: null, // derived in App on boot to avoid import cycle with nostr-tools here
  setKeys: (priv, pub) => {
    if (priv) localStorage.setItem('nostrPrivateKey', priv);
    else localStorage.removeItem('nostrPrivateKey');
    set({ privateKey: priv, publicKey: pub });
  },
  logout: () => {
    localStorage.removeItem('nostrPrivateKey');
    set({ privateKey: null, publicKey: null });
  },

  // ui
  theme: storedTheme,
  setTheme: (t) => {
    localStorage.setItem('nostrdome_theme', t);
    set({ theme: t });
  },
  isMemberSidebarOpen: true,
  toggleMemberSidebar: () =>
    set((s) => ({ isMemberSidebarOpen: !s.isMemberSidebarOpen })),
  isMultiServerComingModalOpen: false,
  openComingModal: () => set({ isMultiServerComingModalOpen: true }),
  closeComingModal: () => set({ isMultiServerComingModalOpen: false }),
  selectedMemberPubkey: null,
  selectMember: (pubkey) => set({ selectedMemberPubkey: pubkey }),

  // community
  activeGroupId: null,
  setActiveGroup: (id) => set({ activeGroupId: id }),

  communities: {},
  liveStatus: {},
  liveError: {},
  resetLive: (groupId) =>
    set((s) => {
      const nextCommunities = { ...s.communities };
      delete nextCommunities[groupId];
      const nextStatus = { ...s.liveStatus };
      delete nextStatus[groupId];
      const nextError = { ...s.liveError };
      delete nextError[groupId];
      const nextPresence = { ...s.presence };
      delete nextPresence[groupId];
      // Close the member panel only if it points at the group being reset.
      const closeMemberPanel = s.activeGroupId === groupId;
      return {
        communities: nextCommunities,
        liveStatus: nextStatus,
        liveError: nextError,
        presence: nextPresence,
        selectedMemberPubkey: closeMemberPanel ? null : s.selectedMemberPubkey,
      };
    }),
  applyLiveMetadata: (groupId, m) =>
    set((s) => mergeCommunity(s, groupId, (live) => ({ ...live, metadata: m }))),
  applyLiveAdmins: (groupId, admins) =>
    set((s) => mergeCommunity(s, groupId, (live) => ({ ...live, admins }))),
  applyLiveMembers: (groupId, members) =>
    set((s) => mergeCommunity(s, groupId, (live) => ({ ...live, members }))),
  applyLiveRoles: (groupId, roles) =>
    set((s) => mergeCommunity(s, groupId, (live) => ({
      ...live,
      roles: [...roles].sort((a, b) => b.priority - a.priority),
    }))),
  upsertLiveCategory: (groupId, category) =>
    set((s) => mergeCommunity(s, groupId, (live) => {
      const others = live.categories.filter((c) => c.id !== category.id);
      return { ...live, categories: [...others, category].sort((a, b) => a.position - b.position) };
    })),
  upsertLiveChannel: (groupId, channel) =>
    set((s) => mergeCommunity(s, groupId, (live) => {
      const others = live.channels.filter((c) => c.id !== channel.id);
      return { ...live, channels: [...others, channel].sort((a, b) => a.position - b.position) };
    })),

  setLiveStatus: (groupId, status, err = null) =>
    set((s) => ({
      liveStatus: { ...s.liveStatus, [groupId]: status },
      liveError: { ...s.liveError, [groupId]: err },
    })),

  collapsedCategories: (() => {
    try {
      const raw = localStorage.getItem('nostrdome_collapsed_categories');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })(),
  toggleCategoryCollapsed: (key) =>
    set((state) => {
      const next = { ...state.collapsedCategories, [key]: !state.collapsedCategories[key] };
      localStorage.setItem('nostrdome_collapsed_categories', JSON.stringify(next));
      return { collapsedCategories: next };
    }),

  // members
  profiles: {},
  setProfile: (pubkey, profile) =>
    set((s) => ({ profiles: { ...s.profiles, [pubkey]: profile } })),
  setProfiles: (entries) =>
    set((s) => {
      if (!entries.length) return {};
      const next = { ...s.profiles };
      for (const { pubkey, profile } of entries) next[pubkey] = profile;
      return { profiles: next };
    }),

  // presence
  presence: {},
  setPresence: (groupId, pubkey, lastSeen) =>
    set((s) => {
      const groupPresence = s.presence[groupId] ?? {};
      // Skip churn if newer (or equal) heartbeat already known.
      if ((groupPresence[pubkey] ?? 0) >= lastSeen) return {};
      return {
        presence: { ...s.presence, [groupId]: { ...groupPresence, [pubkey]: lastSeen } },
      };
    }),
  resetPresence: (groupId) =>
    set((s) => {
      if (!(groupId in s.presence)) return {};
      const next = { ...s.presence };
      delete next[groupId];
      return { presence: next };
    }),

  // chat (§1.6) — drafts + mute list, persisted to localStorage.
  drafts: (() => {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })(),
  setDraft: (groupId, channelId, value) =>
    set((s) => {
      const k = draftKey(groupId, channelId);
      // Drop empties so the dictionary doesn't grow unboundedly with
      // ephemeral channel visits.
      const next = { ...s.drafts };
      if (value) next[k] = value;
      else delete next[k];
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(next)); } catch {}
      return { drafts: next };
    }),
  clearDraft: (groupId, channelId) =>
    set((s) => {
      const k = draftKey(groupId, channelId);
      if (!(k in s.drafts)) return {};
      const next = { ...s.drafts };
      delete next[k];
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(next)); } catch {}
      return { drafts: next };
    }),

  mutedPubkeys: (() => {
    try {
      const raw = localStorage.getItem(MUTED_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  })(),
  toggleMuted: (pubkey) =>
    set((s) => {
      const has = s.mutedPubkeys.includes(pubkey);
      const next = has
        ? s.mutedPubkeys.filter((p) => p !== pubkey)
        : [...s.mutedPubkeys, pubkey];
      try { localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch {}
      return { mutedPubkeys: next };
    }),
}));

// Per-group selector helpers. Components pass the groupId they care about
// (usually from the route params) and get back the projection of *that*
// community without re-rendering when an unrelated group updates.
//
// Falls back to emptyLiveCommunity when the group is unknown, so consumers
// never have to null-check the projection itself.
export const useLive = (groupId: string | null): LiveCommunityState =>
  useAppStore((s) =>
    groupId ? s.communities[groupId] ?? emptyLiveCommunity : emptyLiveCommunity,
  );

export const useLiveStatus = (groupId: string | null): LiveStatus =>
  useAppStore((s) => (groupId ? s.liveStatus[groupId] ?? 'idle' : 'idle'));

export const useLiveError = (groupId: string | null): string | null =>
  useAppStore((s) => (groupId ? s.liveError[groupId] ?? null : null));

// Hoisted so the `?? EMPTY_PRESENCE` fallback returns a stable reference;
// inline `?? {}` would mint a new object on every store update and trigger
// infinite re-renders in any component that depends on the result (Zustand
// v5 uses Object.is to detect changes).
const EMPTY_PRESENCE: Record<string, number> = Object.freeze({}) as Record<string, number>;

export const useGroupPresence = (groupId: string | null): Record<string, number> =>
  useAppStore((s) => (groupId ? s.presence[groupId] ?? EMPTY_PRESENCE : EMPTY_PRESENCE));

// Convenience selectors (avoid re-renders on unrelated slice changes).
export const useAuth = () => useAppStore((s) => ({
  privateKey: s.privateKey,
  publicKey: s.publicKey,
  setKeys: s.setKeys,
  logout: s.logout,
}));

export const useTheme = () => useAppStore((s) => ({
  theme: s.theme,
  setTheme: s.setTheme,
}));
