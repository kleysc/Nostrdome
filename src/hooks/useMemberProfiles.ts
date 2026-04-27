// Batches kind 0 (NIP-01 metadata) lookups for the active community's
// member set. Runs against the public-relay SimplePool from RootContext —
// the live (NIP-29) relay only stores group-scoped events with an `h` tag,
// so kind 0 lives elsewhere.
//
// Re-subscription policy: only when the *set of pubkeys* changes (stable
// signature). A 39002 update that just rotates roles keeps the same pubkey
// set and must NOT cause a profile resubscription.
//
// Scalability: pubkey list is chunked at REQ_CHUNK so we don't ship a
// gigantic filter to relays that cap REQ size. Each chunk is its own sub.
import { useEffect, useMemo, useRef } from 'react';
import type { Event, SimplePool } from 'nostr-tools';
import { useAppStore } from '../stores/store';
import type { Kind0Profile } from '../stores/community-types';

const REQ_CHUNK = 200;
// Skip cached profiles refetched within this window. Keeps re-mounts cheap.
const PROFILE_REFETCH_TTL_SEC = 60 * 10;

interface UseMemberProfilesOptions {
  pool: SimplePool | null;
  relays: string[];
  pubkeys: string[];
}

export function useMemberProfiles({ pool, relays, pubkeys }: UseMemberProfilesOptions) {
  const setProfiles = useAppStore((s) => s.setProfiles);

  // Stable signature: sorted, unique, deduped pubkeys joined. Re-subs only
  // when the underlying SET changes (membership add/remove), not on every
  // 39002 echo with role-only diffs.
  const signature = useMemo(() => {
    const unique = Array.from(new Set(pubkeys.filter(Boolean))).sort();
    return unique.join(',');
  }, [pubkeys]);

  // Track which pubkeys we've already fetched recently to skip them.
  const lastFetchedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!pool || !signature || !relays.length) return;
    const all = signature.split(',').filter(Boolean);
    const now = Math.floor(Date.now() / 1000);
    const stale = all.filter((pk) => {
      const ts = lastFetchedRef.current.get(pk) ?? 0;
      return now - ts > PROFILE_REFETCH_TTL_SEC;
    });
    if (!stale.length) return;

    let cancelled = false;
    // Buffer events; flush in one bulk merge after EOSE per chunk to avoid
    // N renders for N profiles.
    const buffer = new Map<string, { profile: Kind0Profile; ts: number }>();

    const subs: { unsub: () => void }[] = [];
    for (let i = 0; i < stale.length; i += REQ_CHUNK) {
      const chunk = stale.slice(i, i + REQ_CHUNK);
      const sub = pool.sub(relays, [{ kinds: [0], authors: chunk }]);
      sub.on('event', (e: Event) => {
        try {
          const parsed = JSON.parse(e.content || '{}') as Kind0Profile;
          const prior = buffer.get(e.pubkey);
          // Latest by created_at within this batch.
          if (!prior || e.created_at > prior.ts) {
            buffer.set(e.pubkey, { profile: parsed, ts: e.created_at });
          }
        } catch {
          // Malformed JSON — skip. Don't poison the buffer.
        }
      });
      sub.on('eose', () => {
        if (cancelled) return;
        // Mark *all* requested pubkeys in this chunk as fetched, even those
        // with no kind 0 — otherwise we'd hammer the relay every render.
        for (const pk of chunk) lastFetchedRef.current.set(pk, now);
        // Flush this chunk's profiles to the store in one batch.
        const entries = Array.from(buffer.entries()).map(([pubkey, v]) => ({
          pubkey,
          profile: v.profile,
        }));
        if (entries.length) setProfiles(entries);
        buffer.clear();
      });
      subs.push(sub);
    }

    return () => {
      cancelled = true;
      for (const s of subs) { try { s.unsub(); } catch { /* relay closed */ } }
    };
  }, [pool, relays, signature, setProfiles]);
}
