// Outlet context shared between RootLayout and the route-level views.
// Lives in its own file so route components can import the type without
// pulling in the whole RootLayout.
import type { SimplePool } from 'nostr-tools';

export interface Contact {
  pubkey: string;
  name?: string;
  about?: string;
}

export interface Channel {
  id: string;
  name: string;
  about?: string;
  picture?: string;
  pubkey: string;
  created_at: number;
}

export interface MyProfile {
  name?: string;
  display_name?: string;
  nip05?: string;
  picture?: string;
}

export interface RootContext {
  pool: SimplePool | null;
  contacts: Contact[];
  channels: Channel[];
  myProfile: MyProfile | null;
  onNotify: (title: string, body: string, data?: { messageId?: string; type?: string }) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onLogin: (privateKey: string, initialNickname?: string) => void;
  reloadChannels: () => void;
}
