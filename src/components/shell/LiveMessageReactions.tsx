// Community-scoped reactions: kind 39201 with `h=<groupId>`,
// `e=<channelId>`, `e=<msgId>`, `p=<msgAuthor>` per docs/event-schema.md.
// Distinct from the legacy `MessageReactions` (kind 7 against the public
// pool) which is wired to /c/legacy. We keep the same look/UX (4 emoji
// buttons + count) but route through the live relay so the plugin's
// membership/ACL enforcement applies.
import { useEffect, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { publishLive, type LiveRelay } from '../../lib/live-relay';

const REACTION_KIND = 39201;
const EMOJI_PALETTE = ['👍', '❤️', '😂', '🔥'] as const;
type Emoji = (typeof EMOJI_PALETTE)[number];

interface LiveMessageReactionsProps {
  liveRelay: LiveRelay;
  groupId: string;
  channelId: string;
  messageId: string;
  messageAuthor: string;
  privateKey: string;
  publicKey: string;
}

export default function LiveMessageReactions({
  liveRelay, groupId, channelId, messageId, messageAuthor, privateKey, publicKey,
}: LiveMessageReactionsProps) {
  const [byEmoji, setByEmoji] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    setByEmoji({});
    const sub = liveRelay.relay.sub([
      { kinds: [REACTION_KIND], '#e': [messageId] },
    ]);
    sub.on('event', (e: Event) => {
      // Trust the live relay to enforce that the signer is a member.
      const emoji = e.content;
      if (!emoji) return;
      setByEmoji((prev) => {
        const set = new Set(prev[emoji] ?? []);
        if (set.has(e.pubkey)) return prev;
        set.add(e.pubkey);
        return { ...prev, [emoji]: set };
      });
    });
    return () => { try { sub.unsub(); } catch { /* relay closed */ } };
  }, [liveRelay, messageId]);

  const sendReaction = async (emoji: Emoji) => {
    try {
      await publishLive(liveRelay, privateKey, {
        kind: REACTION_KIND,
        content: emoji,
        tags: [
          ['h', groupId],
          ['e', channelId],
          ['e', messageId],
          ['p', messageAuthor],
        ],
      });
    } catch {
      // Reactions failing is non-critical UX — the parent send banner
      // surfaces auth/perm issues already. Silent here keeps the row tidy.
    }
  };

  const counts = useMemo(() => {
    return EMOJI_PALETTE.map((e) => ({
      emoji: e,
      count: byEmoji[e]?.size ?? 0,
      mine: byEmoji[e]?.has(publicKey) ?? false,
    }));
  }, [byEmoji, publicKey]);

  return (
    <div className="flex gap-1">
      {counts.map(({ emoji, count, mine }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => sendReaction(emoji)}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            mine
              ? 'bg-[var(--primary-color)] text-white'
              : 'bg-[var(--sidebar-active)] text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]'
          }`}
        >
          {emoji}{count > 0 ? ` ${count}` : ''}
        </button>
      ))}
    </div>
  );
}
