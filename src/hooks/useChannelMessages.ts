// Subscribes to kind 39200 (NIP-29 channel_message) for a single
// (groupId, channelId) on the live relay, exposes the message list +
// sender. Pure data layer — render lives in LiveChatPanel.
//
// Why filter by both `#h` and `#e`:
//   • `#h=<groupId>` ensures we only get events from this community, even
//     though the live relay should already enforce that;
//   • `#e=<channelId>` scopes to this channel.
// Some relays index either tag but not both — the join is cheap and gives
// a clean dataset regardless of relay implementation.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import { publishLive, type LiveRelay } from '../lib/live-relay';

export interface ChannelMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  // Reply target — id of the message this one replies to. Resolved against
  // the local list at render time so we can show a quote even before the
  // referenced message arrives via subscription.
  replyTo?: string;
  rawTags: string[][];
}

const HISTORY_LIMIT = 200;

interface UseChannelMessagesOptions {
  liveRelay: LiveRelay | null;
  groupId: string;
  channelId: string | null;
}

interface ReplyTarget {
  id: string;
  pubkey: string;
}

export interface SendOptions {
  content: string;
  reply?: ReplyTarget;
}

export interface UseChannelMessagesResult {
  messages: ChannelMessage[];
  // null while subscribing or if no channel is selected.
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  send: (opts: SendOptions, privateKey: string) => Promise<void>;
}

function parseEventToMessage(e: Event): ChannelMessage {
  // Reply target marker per NIP-10: ["e", id, relay, "reply"].
  const replyTag = e.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
  return {
    id: e.id,
    pubkey: e.pubkey,
    content: e.content,
    createdAt: e.created_at,
    replyTo: replyTag?.[1],
    rawTags: e.tags,
  };
}

// Map publish-rejection error messages from the relay (khatru OK reason
// strings) into a user-facing label. Khatru emits prefixes like
// `auth-required:`, `restricted:`, `rate-limited:`, `blocked:` — we render
// each with a friendly, language-localized message.
export function friendlyPublishError(raw: string): string {
  const msg = (raw || '').toLowerCase();
  if (msg.includes('auth-required')) return 'Sesión sin autenticar — reconectá al relay.';
  if (msg.includes('rate-limited')) return 'Estás enviando demasiado rápido. Esperá un momento.';
  if (msg.includes('restricted')) return 'No tenés permiso para escribir en este canal.';
  if (msg.includes('blocked')) return 'Estás bloqueado en esta comunidad.';
  if (msg.includes('pow')) return 'El relay pidió proof-of-work — no soportado todavía.';
  return raw || 'Error desconocido al publicar.';
}

export function useChannelMessages(opts: UseChannelMessagesOptions): UseChannelMessagesResult {
  const { liveRelay, groupId, channelId } = opts;
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [status, setStatus] = useState<UseChannelMessagesResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  // Stable ref so `send` doesn't re-create on every state churn (avoids
  // composer-input re-renders in the UI).
  const liveRef = useRef<LiveRelay | null>(null);
  liveRef.current = liveRelay;

  useEffect(() => {
    if (!liveRelay || !channelId || !groupId) {
      setMessages([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    setMessages([]);

    const sub = liveRelay.relay.sub([
      { kinds: [39200], '#h': [groupId], '#e': [channelId], limit: HISTORY_LIMIT },
    ]);

    sub.on('event', (e: Event) => {
      const msg = parseEventToMessage(e);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Insert keeping the array sorted by createdAt asc (chat order).
        // Cheap insert — find index from the back since most events arrive
        // at or near the end.
        const next = [...prev];
        let i = next.length - 1;
        while (i >= 0 && next[i].createdAt > msg.createdAt) i--;
        next.splice(i + 1, 0, msg);
        return next;
      });
    });

    sub.on('eose', () => setStatus('ready'));

    return () => {
      try { sub.unsub(); } catch { /* relay closed */ }
    };
  }, [liveRelay, groupId, channelId]);

  const send = useMemo(() => {
    return async ({ content, reply }: SendOptions, privateKey: string) => {
      const live = liveRef.current;
      if (!live || !channelId || !groupId) throw new Error('Canal sin conexión activa.');
      const trimmed = content.trim();
      if (!trimmed) return;

      const tags: string[][] = [
        ['h', groupId],
        ['e', channelId],
      ];
      if (reply) {
        // Per NIP-10: marker "reply" identifies the reply target. Empty
        // relay hint is fine — the live relay is already implicit.
        tags.push(['e', reply.id, '', 'reply']);
        tags.push(['p', reply.pubkey]);
      }

      try {
        const event = await publishLive(live, privateKey, {
          kind: 39200,
          content: trimmed,
          tags,
        });
        // Optimistically insert so the sender sees their message even if
        // the live sub hasn't echoed it yet. The sub's dedup by id handles
        // the eventual echo.
        setMessages((prev) => {
          if (prev.some((m) => m.id === event.id)) return prev;
          return [...prev, parseEventToMessage(event)];
        });
        setError(null);
      } catch (err) {
        const friendly = friendlyPublishError((err as Error).message);
        setError(friendly);
        // Surface as a thrown error too — caller can decide UX (toast etc.).
        throw new Error(friendly);
      }
    };
  }, [groupId, channelId]);

  return { messages, status, error, send };
}
