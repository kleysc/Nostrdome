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
    <div className="starred-shell p-4 rounded-xl">
      <h2 className="text-base font-semibold mb-3 text-[var(--text-color)]">Mensajes destacados</h2>
      <div className="space-y-2">
        {starredMessages.map(msg => (
          <div key={msg.id} className="starred-item p-2.5 rounded-lg flex justify-between gap-3">
            <div>
              <div className="text-xs text-[var(--text-muted)]">
                {nip19.npubEncode(msg.pubkey).slice(0, 10)}...
              </div>
              <div className="text-sm text-[var(--text-color)] break-words">{msg.content}</div>
            </div>
            <button
              onClick={() => removeFromStarred(msg.id)}
              className="starred-remove text-xs px-2 py-1 rounded-md"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StarredMessages; 
