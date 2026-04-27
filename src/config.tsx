// Runtime config injected by the bundle at deploy time (see
// `bundle/runtime-config.js.tpl`). When the SPA is served from a self-host
// install, Caddy serves a script that sets `window.__NOSTRDOME_CONFIG__`
// BEFORE the bundle loads, so the values below pick it up at module load.
// In dev (`npm run dev`) the script is absent and we fall back to Vite
// env vars.
type RuntimeConfig = {
  liveRelayUrl?: string;
  liveGroupId?: string;
  publicRelays?: string[];
};

declare global {
  interface Window {
    __NOSTRDOME_CONFIG__?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig =
  typeof window !== 'undefined' && window.__NOSTRDOME_CONFIG__ ? window.__NOSTRDOME_CONFIG__ : {};

// Public relays used ONLY by the legacy NIP-28 paths (kind 0 profile
// resolution, contacts, legacy channels). The productive NIP-29 flow goes
// through `liveRelayUrl` instead. Resolution order:
//   1. window.__NOSTRDOME_CONFIG__.publicRelays (self-host runtime config)
//   2. VITE_PUBLIC_RELAYS env var (comma-separated; "" → empty list, useful
//      for local-only dev where no public lookup is wanted)
//   3. Built-in defaults (mainnet relays for legacy/profile lookups)
function envPublicRelays(): string[] | null {
  const raw = import.meta.env.VITE_PUBLIC_RELAYS as string | undefined;
  if (raw === undefined) return null;
  if (raw === '') return [];
  return raw.split(',').map((s: string) => s.trim()).filter(Boolean);
}

export const relayUrls =
  (runtime.publicRelays && runtime.publicRelays.length > 0)
    ? runtime.publicRelays
    : envPublicRelays() ?? [
        'wss://relay.damus.io',
        'wss://relay.nostr.net',
        'wss://relay.nostr.info',
      ];

export const DEFAULT_MESSAGE_LIMIT = 50;
export const MESSAGE_LOAD_BATCH = 20;

// Live relay endpoint for NIP-29 communities. Resolution order:
//   1. window.__NOSTRDOME_CONFIG__.liveRelayUrl (self-host runtime config)
//   2. VITE_LIVE_RELAY_URL (build-time env)
//   3. localhost productive relay default (matches scripts/dev-local.sh)
export const liveRelayUrl: string | null =
  runtime.liveRelayUrl ?? import.meta.env.VITE_LIVE_RELAY_URL ?? 'ws://localhost:7777';

export const liveGroupId: string =
  runtime.liveGroupId ?? import.meta.env.VITE_LIVE_GROUP_ID ?? 'mi-comunidad';
