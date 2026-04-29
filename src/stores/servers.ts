// Joined-servers slice for the F2 server bar. Persisted to localStorage
// under one key so a refresh restores the user's bar state immediately.
//
// Future: replace localStorage with kind 30078 (NIP-78 application data)
// so the list syncs across devices. The shape here is forward-compatible
// — adding a `lastReadAt` per server is a minor schema bump.
import { create } from 'zustand';

export interface ServerEntry {
  groupId: string;
  relayUrl: string;
  name: string;
  picture?: string;
  // Last-read timestamp (unix-seconds) per server. Anything newer counts
  // as unread. We don't track per-channel here; server bar only shows the
  // aggregate badge.
  lastReadAt: number;
  // Mute notifications without leaving the server.
  muted: boolean;
  // Operator-controlled order. Lower = leftmost.
  sortIndex: number;
}

interface ServersState {
  servers: ServerEntry[];
  // Active server (mirrors the URL `/c/:groupId`); may be null when on /dm/* etc.
  activeGroupId: string | null;
  // In-memory unread counts. NOT persisted: on reload we recompute from
  // `since: lastReadAt` against the relay. Keyed by groupId.
  unreadCounts: Record<string, number>;

  setActive: (groupId: string | null) => void;
  add: (entry: Omit<ServerEntry, 'lastReadAt' | 'muted' | 'sortIndex'>) => void;
  remove: (groupId: string) => void;
  rename: (groupId: string, name: string, picture?: string) => void;
  markRead: (groupId: string) => void;
  toggleMuted: (groupId: string) => void;
  reorder: (sourceGroupId: string, beforeGroupId: string | null) => void;

  // Background unread tracker setters.
  bumpUnread: (groupId: string) => void;
  resetUnread: (groupId: string) => void;

  // Hydrate from localStorage at module load; called once on store create.
  // Exposed so tests can reset.
  hydrate: () => void;
}

const KEY = 'nostrdome_joined_servers';

function load(): ServerEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ServerEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(servers: ServerEntry[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(servers));
  } catch {
    // Quota exceeded etc — silent: user can still use the app, their list
    // just won't survive the next reload.
  }
}

export const useServers = create<ServersState>((set) => ({
  servers: load(),
  activeGroupId: null,
  unreadCounts: {},

  setActive: (groupId) =>
    set((state) => {
      // Entering a server clears its unread badge immediately. The actual
      // lastReadAt bump happens via markRead — caller decides ordering.
      if (!groupId) return { activeGroupId: groupId };
      if (!state.unreadCounts[groupId]) return { activeGroupId: groupId };
      const next = { ...state.unreadCounts };
      delete next[groupId];
      return { activeGroupId: groupId, unreadCounts: next };
    }),

  add: (entry) =>
    set((state) => {
      if (state.servers.find((s) => s.groupId === entry.groupId)) return {};
      const sortIndex = state.servers.length === 0
        ? 0
        : Math.max(...state.servers.map((s) => s.sortIndex)) + 1;
      const next = [
        ...state.servers,
        { ...entry, lastReadAt: 0, muted: false, sortIndex },
      ];
      persist(next);
      return { servers: next };
    }),

  remove: (groupId) =>
    set((state) => {
      const next = state.servers.filter((s) => s.groupId !== groupId);
      persist(next);
      return { servers: next };
    }),

  rename: (groupId, name, picture) =>
    set((state) => {
      const next = state.servers.map((s) =>
        s.groupId === groupId ? { ...s, name, picture: picture ?? s.picture } : s,
      );
      persist(next);
      return { servers: next };
    }),

  markRead: (groupId) =>
    set((state) => {
      const now = Math.floor(Date.now() / 1000);
      const next = state.servers.map((s) =>
        s.groupId === groupId ? { ...s, lastReadAt: now } : s,
      );
      persist(next);
      // Drop the unread row too (it's transient anyway). Keeps the badge
      // from flicker-popping if a stale event lands milliseconds later.
      const nextUnread = { ...state.unreadCounts };
      delete nextUnread[groupId];
      return { servers: next, unreadCounts: nextUnread };
    }),

  bumpUnread: (groupId) =>
    set((state) => {
      // Don't accumulate badges for the server the user is actively viewing.
      if (state.activeGroupId === groupId) return {};
      const current = state.unreadCounts[groupId] ?? 0;
      // Cap at 99 so the badge stays one digit-pair wide; >99 shows "99+".
      const next = Math.min(current + 1, 99);
      return { unreadCounts: { ...state.unreadCounts, [groupId]: next } };
    }),

  resetUnread: (groupId) =>
    set((state) => {
      if (!state.unreadCounts[groupId]) return {};
      const next = { ...state.unreadCounts };
      delete next[groupId];
      return { unreadCounts: next };
    }),

  toggleMuted: (groupId) =>
    set((state) => {
      const next = state.servers.map((s) =>
        s.groupId === groupId ? { ...s, muted: !s.muted } : s,
      );
      persist(next);
      return { servers: next };
    }),

  reorder: (sourceGroupId, beforeGroupId) =>
    set((state) => {
      const sorted = [...state.servers].sort((a, b) => a.sortIndex - b.sortIndex);
      const src = sorted.find((s) => s.groupId === sourceGroupId);
      if (!src) return {};
      const remaining = sorted.filter((s) => s.groupId !== sourceGroupId);
      const insertAt = beforeGroupId
        ? remaining.findIndex((s) => s.groupId === beforeGroupId)
        : remaining.length;
      const idx = insertAt < 0 ? remaining.length : insertAt;
      remaining.splice(idx, 0, src);
      // Renumber so sortIndex stays compact and stable.
      const next = remaining.map((s, i) => ({ ...s, sortIndex: i }));
      persist(next);
      return { servers: next };
    }),

  hydrate: () => set({ servers: load() }),
}));

// Selector convenience: returns the active ServerEntry (or null) without
// triggering re-render on unrelated server-list changes.
export function useActiveServer(): ServerEntry | null {
  return useServers((s) => {
    if (!s.activeGroupId) return null;
    return s.servers.find((srv) => srv.groupId === s.activeGroupId) ?? null;
  });
}
