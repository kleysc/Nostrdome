import React, { useState, useEffect } from 'react';
import { SimplePool, Event, getEventHash, getSignature } from 'nostr-tools';
import { relayUrls } from '../config';

interface ReactionProps {
  messageId: string;
  pool: SimplePool;
  publicKey: string;
  privateKey: string;
}

const MessageReactions: React.FC<ReactionProps> = ({ messageId, pool, publicKey, privateKey }) => {
  const [reactions, setReactions] = useState<Record<string, Set<string>>>({
    '👍': new Set(),
    '❤️': new Set(),
    '😂': new Set(),
    '🔥': new Set(),
  });

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{
      kinds: [7],
      '#e': [messageId]
    }]);

    sub.on('event', (event: Event) => {
      const emoji = event.content;
      if (reactions[emoji]) {
        setReactions(prev => ({
          ...prev,
          [emoji]: new Set([...prev[emoji], event.pubkey])
        }));
      }
    });

    return () => {
      sub.unsub();
    };
  }, [messageId, pool]);

  const sendReaction = async (emoji: string) => {
    const event: Event = {
      kind: 7,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', messageId]],
      content: emoji,
      id: '',
      sig: ''
    };

    event.id = getEventHash(event);
    event.sig = getSignature(event, privateKey);

    await pool.publish(relayUrls, event);
  };

  return (
    <div className="flex gap-2">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => sendReaction(emoji)}
          className={`px-2 py-1 rounded text-sm ${
            users.has(publicKey) ? 'bg-green-600' : 'bg-gray-600 hover:bg-gray-500'
          }`}
        >
          {emoji} {users.size > 0 && users.size}
        </button>
      ))}
    </div>
  );
};

export default MessageReactions; 