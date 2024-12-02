import React, { useEffect, useState } from 'react';
import { nip19 } from 'nostr-tools';

interface StarredMessage {
  id: string;
  content: string;
  pubkey: string;
  created_at: number;
}

const StarredMessages: React.FC = () => {
  const [starredMessages, setStarredMessages] = useState<StarredMessage[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('starred_messages');
    if (stored) {
      setStarredMessages(JSON.parse(stored));
    }
  }, []);

  const removeFromStarred = (id: string) => {
    const updated = starredMessages.filter(msg => msg.id !== id);
    setStarredMessages(updated);
    localStorage.setItem('starred_messages', JSON.stringify(updated));
  };

  return (
    <div className="bg-gray-900 p-4 rounded">
      <h2 className="text-xl mb-4">Starred Messages</h2>
      <div className="space-y-2">
        {starredMessages.map(msg => (
          <div key={msg.id} className="bg-gray-800 p-2 rounded flex justify-between">
            <div>
              <div className="text-sm text-gray-400">
                {nip19.npubEncode(msg.pubkey).slice(0, 10)}...
              </div>
              <div>{msg.content}</div>
            </div>
            <button
              onClick={() => removeFromStarred(msg.id)}
              className="text-red-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StarredMessages; 