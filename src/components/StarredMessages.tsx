import React, { useEffect, useState } from 'react';
import { nip19 } from 'nostr-tools';

export interface StarredMessage {
  id: string;
  content: string;
  pubkey: string;
  created_at: number;
}

const STORAGE_KEY = 'starred_messages';

export function loadStarredFromStorage(): StarredMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveStarredToStorage(list: StarredMessage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

interface StarredMessagesProps {
  messages?: StarredMessage[];
  onRemove?: (id: string) => void;
  onMessagesChange?: (list: StarredMessage[]) => void;
}

const StarredMessages: React.FC<StarredMessagesProps> = ({ messages: controlledMessages, onRemove, onMessagesChange }) => {
  const [internalMessages, setInternalMessages] = useState<StarredMessage[]>([]);

  useEffect(() => {
    if (controlledMessages === undefined) {
      setInternalMessages(loadStarredFromStorage());
    }
  }, [controlledMessages]);

  const starredMessages = controlledMessages ?? internalMessages;

  const removeFromStarred = (id: string) => {
    const updated = starredMessages.filter(msg => msg.id !== id);
    if (onRemove) {
      onRemove(id);
    } else if (onMessagesChange) {
      onMessagesChange(updated);
    } else {
      setInternalMessages(updated);
      saveStarredToStorage(updated);
    }
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