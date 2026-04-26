export const relayUrls = [
    'wss://relay.damus.io',
    'wss://relay.nostr.net',
    'wss://relay.nostr.info',
    'wss://relay.nostr.info',
    //'wss://nostr-pub.wellorder.net',
    //'wss://relay.mostro.network',
  ];

export const DEFAULT_MESSAGE_LIMIT = 50;
export const MESSAGE_LOAD_BATCH = 20;

// Live relay endpoint for NIP-29 communities. Set via `VITE_LIVE_RELAY_URL`
// at build time, or default to the localhost spike for development. In
// production this comes from `community.json` at boot (D-002).
export const liveRelayUrl: string | null =
  import.meta.env.VITE_LIVE_RELAY_URL ?? 'ws://localhost:7780';

// Group id of the seeded community on the local spike relay.
export const liveGroupId: string = import.meta.env.VITE_LIVE_GROUP_ID ?? 'spike-group';
