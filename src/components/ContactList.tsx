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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 p-3">
        <h2 className="sidebar-heading">Contactos / DMs</h2>
        <button
          type="button"
          onClick={() => onSelectContact(null)}
          className={`sidebar-item w-full text-left py-2 px-3 rounded text-sm text-[var(--text-color)] ${selectedContact === null ? 'active' : ''}`}
        >
          📡 Feed global
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 px-2 pb-2">
        {contacts.map((contact) => (
          <button
            key={contact.pubkey}
            type="button"
            onClick={() => onSelectContact(contact.pubkey)}
            className={`sidebar-item w-full text-left py-2 px-3 rounded text-sm text-[var(--text-color)] ${selectedContact === contact.pubkey ? 'active' : ''}`}
          >
            <div className="font-medium truncate" title={contact.pubkey}>
              {contact.name || nip19.npubEncode(contact.pubkey).slice(0, 10) + '…'}
            </div>
            {contact.about && <div className="text-xs text-[var(--text-muted)] truncate">{contact.about}</div>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ContactList; 