import React from 'react';
import { nip19 } from 'nostr-tools';

interface Contact {
  pubkey: string;
  name?: string;
  about?: string;
}

interface ContactListProps {
  contacts: Contact[];
  onSelectContact: (pubkey: string) => void;
}

const ContactList: React.FC<ContactListProps> = ({ contacts, onSelectContact }) => {
  return (
    <div className="w-64 bg-gray-900 p-4 overflow-y-auto">
      <h2 className="text-xl mb-4">Contacts</h2>
      <div className="space-y-2">
        {contacts.map((contact) => (
          <div
            key={contact.pubkey}
            onClick={() => onSelectContact(contact.pubkey)}
            className="p-2 hover:bg-gray-800 rounded cursor-pointer"
          >
            <div className="font-bold">{contact.name || nip19.npubEncode(contact.pubkey).slice(0, 10)}</div>
            {contact.about && <div className="text-sm text-gray-400">{contact.about}</div>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContactList; 