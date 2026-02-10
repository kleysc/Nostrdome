import React, { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { relayUrls } from '../config';

interface TypingIndicatorProps {
  pool: SimplePool;
  publicKey: string;
}

const TypingIndicator: React.FC<TypingIndicatorProps> = ({ pool, publicKey }) => {
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sub = pool.sub([...relayUrls], [{
      kinds: [20], // Typing indicator event kind
      since: Math.floor(Date.now() / 1000) - 5
    }]);

    sub.on('event', (event: Event) => {
      if (event.pubkey !== publicKey) {
        setTypingUsers(prev => {
          const newSet = new Set(prev);
          newSet.add(event.pubkey);
          setTimeout(() => {
            setTypingUsers(current => {
              const updated = new Set(current);
              updated.delete(event.pubkey);
              return updated;
            });
          }, 3000);
          return newSet;
        });
      }
    });

    return () => {
      sub.unsub();
    };
  }, [pool, publicKey]);

  if (typingUsers.size === 0) return null;

  return (
    <div className="text-xs italic text-[var(--text-muted)] mb-1.5 px-1">
      {Array.from(typingUsers).length} {typingUsers.size === 1 ? 'persona escribiendo...' : 'personas escribiendo...'}
    </div>
  );
};

export default TypingIndicator; 
