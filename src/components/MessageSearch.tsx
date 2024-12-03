import React, { useState } from 'react';

interface MessageSearchProps {
  onSearch: (query: string) => void;
}

const MessageSearch: React.FC<MessageSearchProps> = ({ onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  return (
    <form onSubmit={handleSearch} className="flex gap-2 p-2">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Buscar mensajes..."
        className="flex-grow bg-gray-200 text-black p-2 rounded focus:outline-none"
      />
      <button
        type="submit"
        className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-600"
      >
        Search
      </button>
    </form>
  );
};

export default MessageSearch; 