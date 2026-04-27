// Connects to the live relay, authenticates, and subscribes to all
// community-shaped events (kinds 39000-39101). Populates the store via
// the live setters. Returns the live relay handle so consumers (modals,
// chat) can publish events too.
import { useEffect, useRef, useState } from 'react';
import type { Event, Sub } from 'nostr-tools';
import { connectAndAuth, type LiveRelay } from '../lib/live-relay';
import { useAppStore } from '../stores/store';
import type {
  AdminEntry, MemberEntry, RoleDef, CategoryDef, ChannelDef,
} from '../stores/community-types';

interface UseLiveCommunityOptions {
  groupId: string;
  relayUrl: string | null;
  privateKey: string | null;
}

interface UseLiveCommunityResult {
  liveRelay: LiveRelay | null;
}

function tryParse<T>(content: string): T | null {
  try { return JSON.parse(content || '{}'); } catch { return null; }
}

function getDTag(event: Event): string | null {
  for (const t of event.tags) if (t[0] === 'd') return t[1] ?? null;
  return null;
}

export function useLiveCommunity(opts: UseLiveCommunityOptions): UseLiveCommunityResult {
  const { groupId, relayUrl, privateKey } = opts;
  const [liveRelay, setLiveRelay] = useState<LiveRelay | null>(null);
  const cancelledRef = useRef(false);

  const setLiveStatus = useAppStore((s) => s.setLiveStatus);
  const resetLive = useAppStore((s) => s.resetLive);
  const applyLiveMetadata = useAppStore((s) => s.applyLiveMetadata);
  const applyLiveAdmins = useAppStore((s) => s.applyLiveAdmins);
  const applyLiveMembers = useAppStore((s) => s.applyLiveMembers);
  const applyLiveRoles = useAppStore((s) => s.applyLiveRoles);
  const upsertLiveCategory = useAppStore((s) => s.upsertLiveCategory);
  const upsertLiveChannel = useAppStore((s) => s.upsertLiveChannel);

  useEffect(() => {
    if (!relayUrl || !privateKey) return;
    cancelledRef.current = false;
    resetLive(groupId);
    setLiveStatus(groupId, 'connecting');

    let live: LiveRelay | null = null;
    const subs: Sub[] = [];

    (async () => {
      try {
        live = await connectAndAuth(relayUrl, privateKey);
        if (cancelledRef.current) { live.close(); return; }
        setLiveRelay(live);
        setLiveStatus(groupId, 'subscribing');

        // ── kind 39000: group_metadata ─────────────────────────────────
        const sMeta = live.relay.sub([{ kinds: [39000], '#d': [groupId] }]);
        sMeta.on('event', (e: Event) => {
          const c = tryParse<{ name?: string; picture?: string; about?: string; owner_pubkey?: string }>(e.content);
          if (!c?.owner_pubkey) return;
          applyLiveMetadata(groupId, {
            groupId,
            name: c.name ?? groupId,
            picture: c.picture,
            about: c.about,
            ownerPubkey: c.owner_pubkey,
          });
        });
        subs.push(sMeta);

        // ── kind 39001: group_admins ───────────────────────────────────
        const sAdmins = live.relay.sub([{ kinds: [39001], '#d': [groupId] }]);
        sAdmins.on('event', (e: Event) => {
          const c = tryParse<{ admins?: AdminEntry[] }>(e.content);
          if (c?.admins) applyLiveAdmins(groupId, c.admins);
        });
        subs.push(sAdmins);

        // ── kind 39002: group_members ──────────────────────────────────
        const sMembers = live.relay.sub([{ kinds: [39002], '#d': [groupId] }]);
        sMembers.on('event', (e: Event) => {
          const c = tryParse<{ members?: Array<{ pubkey: string; role_ids?: string[]; roleIds?: string[]; joined_at?: number; joinedAt?: number; display_override?: string; displayOverride?: string; picture_override?: string; pictureOverride?: string }> }>(e.content);
          if (!c?.members) return;
          const normalized: MemberEntry[] = c.members.map((m) => ({
            pubkey: m.pubkey,
            roleIds: m.roleIds ?? m.role_ids ?? [],
            joinedAt: m.joinedAt ?? m.joined_at ?? 0,
            displayOverride: m.displayOverride ?? m.display_override,
            pictureOverride: m.pictureOverride ?? m.picture_override,
          }));
          applyLiveMembers(groupId, normalized);
        });
        subs.push(sMembers);

        // ── kind 39003: group_roles ────────────────────────────────────
        const sRoles = live.relay.sub([{ kinds: [39003], '#d': [groupId] }]);
        sRoles.on('event', (e: Event) => {
          const c = tryParse<{ roles?: RoleDef[] }>(e.content);
          if (c?.roles) applyLiveRoles(groupId, c.roles);
        });
        subs.push(sRoles);

        // ── kind 39101: categories ─────────────────────────────────────
        const sCategories = live.relay.sub([{ kinds: [39101], '#h': [groupId] }]);
        sCategories.on('event', (e: Event) => {
          const id = getDTag(e);
          if (!id) return;
          const c = tryParse<{ name?: string; position?: number }>(e.content);
          if (!c) return;
          const cat: CategoryDef = {
            id,
            name: c.name ?? id,
            position: c.position ?? 0,
          };
          upsertLiveCategory(groupId, cat);
        });
        subs.push(sCategories);

        // ── kind 39100: channels ───────────────────────────────────────
        const sChannels = live.relay.sub([{ kinds: [39100], '#h': [groupId] }]);
        sChannels.on('event', (e: Event) => {
          const id = getDTag(e);
          if (!id) return;
          const c = tryParse<{
            name?: string; category_id?: string; type?: ChannelDef['type'];
            topic?: string; position?: number; write_roles?: string[]; read_roles?: string[];
          }>(e.content);
          if (!c) return;
          const ch: ChannelDef = {
            id,
            name: c.name ?? id,
            categoryId: c.category_id,
            type: c.type ?? 'text',
            topic: c.topic,
            position: c.position ?? 0,
            writeRoles: c.write_roles ?? ['everyone'],
            readRoles: c.read_roles ?? ['everyone'],
          };
          upsertLiveChannel(groupId, ch);
        });
        subs.push(sChannels);

        // First eose across all subs flips the status to ready.
        let pending = subs.length;
        for (const s of subs) {
          s.on('eose', () => {
            pending -= 1;
            if (pending <= 0 && !cancelledRef.current) setLiveStatus(groupId, 'ready');
          });
        }
      } catch (err) {
        if (!cancelledRef.current) setLiveStatus(groupId, 'error', (err as Error).message);
      }
    })();

    return () => {
      cancelledRef.current = true;
      for (const s of subs) { try { s.unsub(); } catch {} }
      if (live) live.close();
      setLiveRelay(null);
      resetLive(groupId);
    };
  }, [groupId, relayUrl, privateKey, resetLive, setLiveStatus, applyLiveMetadata, applyLiveAdmins, applyLiveMembers, applyLiveRoles, upsertLiveCategory, upsertLiveChannel]);

  return { liveRelay };
}
