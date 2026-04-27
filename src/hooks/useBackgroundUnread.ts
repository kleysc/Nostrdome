// Background unread tracker for the F2 server bar.
//
// For every joined server that the user is NOT actively viewing (and not
// muted), we keep one authed NIP-29 connection open and subscribe to
// kind 39200 events with `since: lastReadAt`. Each event bumps the
// per-group counter in `useServers.unreadCounts`, which the server bar
// renders as a numeric badge.
//
// Lifecycle is keyed on a content signature of the joined-servers list +
// active id + auth identity. Any change tears down the previous tracker
// set and rebuilds — much simpler than diffing add/remove/mute edits in
// place, and the cost is trivial at F2 scale (≤10 joined servers per
// user is the realistic upper bound).
//
// Connection sharing: if two servers point at the same relayUrl we open
// one LiveRelay and attach two subs. Saves AUTH round-trips and keeps
// the relay's per-IP connection count low.
import { useEffect } from 'react';
import type { Event, Sub } from 'nostr-tools';
import { connectAndAuth, type LiveRelay } from '../lib/live-relay';
import { useServers } from '../stores/servers';

interface UseBackgroundUnreadOptions {
  privateKey: string | null;
}

export function useBackgroundUnread({ privateKey }: UseBackgroundUnreadOptions) {
  // Subscribe to the slice fields we depend on directly so the effect's
  // signature derives from up-to-date data, not a stale snapshot. Using
  // primitive selectors keeps each call cheap.
  const servers = useServers((s) => s.servers);
  const activeGroupId = useServers((s) => s.activeGroupId);
  const bumpUnread = useServers((s) => s.bumpUnread);

  // A stable signature so React's dep array doesn't churn just because
  // `servers` is a fresh array reference after every persist.
  const sig = servers
    .map((s) => `${s.groupId}|${s.relayUrl}|${s.lastReadAt}|${s.muted ? 1 : 0}`)
    .join('@@');

  useEffect(() => {
    if (!privateKey) return;
    if (!servers.length) return;

    // Targets to actually track: skip the active server (foreground sub
    // already covers it) and skip muted (operator opted out of badges).
    const targets = servers.filter(
      (s) => s.groupId !== activeGroupId && !s.muted,
    );
    if (!targets.length) return;

    let cancelled = false;
    const relayPool = new Map<string, Promise<LiveRelay>>();
    const subs: Sub[] = [];

    // Connect (or reuse) per relay URL.
    const getRelay = (url: string): Promise<LiveRelay> => {
      const existing = relayPool.get(url);
      if (existing) return existing;
      const p = connectAndAuth(url, privateKey);
      relayPool.set(url, p);
      return p;
    };

    void (async () => {
      for (const server of targets) {
        if (cancelled) return;
        let live: LiveRelay;
        try {
          live = await getRelay(server.relayUrl);
        } catch {
          // Auth or connection failure: skip this server silently. The
          // foreground sub will surface the error to the user when they
          // navigate into the affected community.
          continue;
        }
        if (cancelled) return;
        // since must be > lastReadAt so an event with created_at == lastReadAt
        // (e.g. the very message that bumped it) doesn't get re-counted.
        const since = server.lastReadAt + 1;
        const sub = live.relay.sub([
          { kinds: [39200], '#h': [server.groupId], since },
        ]);
        sub.on('event', (_e: Event) => {
          if (cancelled) return;
          bumpUnread(server.groupId);
        });
        subs.push(sub);
      }
    })();

    return () => {
      cancelled = true;
      for (const sub of subs) {
        try { sub.unsub(); } catch { /* relay closed */ }
      }
      // Close every relay we opened. Promise might still be pending if
      // teardown raced the connect — await + close to avoid the leaked
      // socket warning.
      for (const p of relayPool.values()) {
        p.then((live) => { try { live.close(); } catch {} }).catch(() => {});
      }
    };
  }, [privateKey, sig, activeGroupId, bumpUnread]); // eslint-disable-line react-hooks/exhaustive-deps
}
