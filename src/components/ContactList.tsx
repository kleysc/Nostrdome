import React from 'react';
import { nip19 } from 'nostr-tools';

interface Contact {
  pubkey: string;
  name?: string;
  about?: string;
}

interface ContactListProps {
  contacts: Contact[];
  selectedContact: string | null;
  onSelectContact: (pubkey: string | null) => void;
}

const ContactList: React.FC<ContactListProps> = ({ contacts, selectedContact, onSelectContact }) => {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-gray-900/80">
      <div className="shrink-0 p-3">
        <h2 className="text-sm font-bold mb-2 opacity-80">Contactos / DMs</h2>
        <button
          type="button"
          onClick={() => onSelectContact(null)}
          className={`text-left p-2 rounded mb-1 text-sm w-full ${selectedContact === null ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
        >
          📡 Feed global
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 p-3 pt-0">
        {contacts.map((contact) => (
          <button
            key={contact.pubkey}
            type="button"
            onClick={() => onSelectContact(contact.pubkey)}
            className={`w-full text-left p-2 rounded text-sm ${
              selectedContact === contact.pubkey ? 'bg-gray-700' : 'hover:bg-gray-800'
            }`}
          >
            <div className="font-medium truncate" title={contact.pubkey}>
              {contact.name || nip19.npubEncode(contact.pubkey).slice(0, 10) + '…'}
            </div>
            {contact.about && <div className="text-xs text-gray-400 truncate">{contact.about}</div>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ContactList; 