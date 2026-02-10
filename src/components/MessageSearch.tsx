import React, { useState } from 'react';

interface MessageSearchProps {
  onSearch: (query: string) => void;
}

const MessageSearch: React.FC<MessageSearchProps> = ({ onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex gap-2 items-center min-w-0 flex-1">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => {
          const q = e.target.value;
          setSearchQuery(q);
          onSearch(q);
        }}
        placeholder="Buscar mensajes..."
        className="flex-grow min-w-0 max-w-[200px] sm:max-w-none py-1.5 px-3 text-sm rounded-md"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => {
            setSearchQuery('');
            onSearch('');
          }}
          className="text-sm px-2 py-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-color)] hover:bg-[var(--sidebar-hover)]"
        >
          ✕
        </button>
      )}
    </div>
  );
};

export default MessageSearch; 