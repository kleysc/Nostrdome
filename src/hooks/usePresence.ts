// Publishes our own member-presence heartbeat (ephemeral kind 21000) to the
// live relay every PRESENCE_HEARTBEAT_SEC and subscribes to other members'
// heartbeats, populating the `presence` map in the store.
//
// The live relay (NIP-29 + NIP-42) already enforces that only authed members
// can publish events with `h=<group_id>`, so a heartbeat received here is
// guaranteed to be a member's. We trust the signer pubkey on its face.
//
// Lifecycle:
//   • mount:       subscribe + emit one immediate heartbeat (so we appear
//                  online instantly, not after 30s).
//   • every 30s:   re-publish heartbeat (skipped if the publish promise is
//                  still in flight to avoid a backlog on a flaky relay).
//   • unmount:     unsub, clear interval, drop our presence row.
import { useEffect, useRef } from 'react';
import type { Event } from 'nostr-tools';
import { publishLive, type LiveRelay } from '../lib/live-relay';
import { useAppStore } from '../stores/store';
import { PRESENCE_HEARTBEAT_SEC, PRESENCE_KIND, PRESENCE_ONLINE_WINDOW_SEC } from '../stores/community-types';

interface UsePresenceOptions {
  liveRelay: LiveRelay | null;
  groupId: string;
  privateKey: string | null;
  myPubkey: string | null;
}

export function usePresence({ liveRelay, groupId, privateKey, myPubkey }: UsePresenceOptions) {
  const setPresence = useAppStore((s) => s.setPresence);

  // Guard against overlapping publishes. We never await a heartbeat outside
  // the publish callback so the next interval tick won't queue if the prior
  // one is stuck on a slow relay.
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!liveRelay || !privateKey || !groupId) return;

    let cancelled = false;
    const since = Math.floor(Date.now() / 1000) - PRESENCE_ONLINE_WINDOW_SEC;
    const sub = liveRelay.relay.sub([
      { kinds: [PRESENCE_KIND], '#h': [groupId], since },
    ]);

    sub.on('event', (e: Event) => {
      if (cancelled) return;
      setPresence(groupId, e.pubkey, e.created_at);
    });

    const fire = async () => {
      if (cancelled || inflightRef.current) return;
      inflightRef.current = true;
      try {
        await publishLive(liveRelay, privateKey, {
          kind: PRESENCE_KIND,
          content: '',
          tags: [['h', groupId]],
        });
        if (myPubkey) setPresence(groupId, myPubkey, Math.floor(Date.now() / 1000));
      } catch {
        // Ignore publish errors — next tick will retry. A persistent failure
        // shows up to the user via the relay status badge in the sidebar.
      } finally {
        inflightRef.current = false;
      }
    };

    void fire();
    const interval = window.setInterval(fire, PRESENCE_HEARTBEAT_SEC * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      try { sub.unsub(); } catch { /* relay closed */ }
    };
  }, [liveRelay, groupId, privateKey, myPubkey, setPresence]);
}
