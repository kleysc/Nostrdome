// The route element for `/c/:groupId/:channelId?/:messageId?`. For Bloque 1
// it renders the legacy NIP-28 channel list and DMs in the new shell.
// In §1.4 it switches to NIP-29 community subscriptions and the channelId
// from the URL becomes the source of truth for the chat panel.
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import AppShell from './AppShell';
import ChannelList from '../ChannelList';
import ContactList from '../ContactList';
import RelayStatus from '../RelayStatus';
import Chat from '../Chat';
import { useAppStore } from '../../stores/store';
import type { RootContext } from './context';

export default function ChannelView() {
  const ctx = useOutletContext<RootContext>();
  const privateKey = useAppStore((s) => s.privateKey);
  const publicKey = useAppStore((s) => s.publicKey);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [unifiedFeed, setUnifiedFeed] = useState(false);

  if (!ctx.pool || !privateKey || !publicKey) return null;

  return (
    <AppShell
      publicKey={publicKey}
      onOpenProfile={ctx.onOpenProfile}
      onLogout={ctx.onLogout}
      channelSidebar={
        <>
          <ChannelList
            channels={ctx.channels}
            selectedChannelId={selectedChannelId}
            unifiedFeed={unifiedFeed}
            onSelectChannel={(id) => {
              setSelectedChannelId(id);
              setUnifiedFeed(false);
              if (id) setSelectedContact(null);
            }}
            onSelectUnified={() => {
              setUnifiedFeed(true);
              setSelectedChannelId(null);
              setSelectedContact(null);
            }}
            pool={ctx.pool}
            privateKey={privateKey}
            publicKey={publicKey}
            onChannelCreated={ctx.reloadChannels}
          />
          <ContactList
            contacts={ctx.contacts}
            selectedContact={selectedContact}
            onSelectContact={(pubkey) => {
              setSelectedContact((prev) => (prev === pubkey ? null : pubkey));
              setSelectedChannelId(null);
              setUnifiedFeed(false);
            }}
          />
          <RelayStatus pool={ctx.pool} />
        </>
      }
      chatPanel={
        <Chat
          privateKey={privateKey}
          publicKey={publicKey}
          pool={ctx.pool}
          selectedContact={selectedContact}
          selectedChannelId={selectedChannelId}
          channelName={selectedChannelId ? ctx.channels.find((c) => c.id === selectedChannelId)?.name : undefined}
          unifiedFeed={unifiedFeed}
          channels={ctx.channels}
          onNotify={ctx.onNotify}
        />
      }
    />
  );
}
