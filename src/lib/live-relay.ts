// Helper to connect to a single Nostrdome relay (NIP-29 group host) and
// complete NIP-42 AUTH automatically. Used by §1.4 onward whenever the
// route is a live community (groupId !== "legacy").
import {
  relayInit, type Relay, type Event, getEventHash, getSignature, getPublicKey,
} from 'nostr-tools';

export interface LiveRelay {
  relay: Relay;
  authedPubkey: string;
  close: () => void;
}

export async function connectAndAuth(url: string, privateKey: string): Promise<LiveRelay> {
  const relay = relayInit(url);
  const pubkey = getPublicKey(privateKey);

  let authResolve: () => void = () => {};
  let authReject: (e: Error) => void = () => {};
  const authed = new Promise<void>((resolve, reject) => {
    authResolve = resolve;
    authReject = reject;
  });

  relay.on('auth', async (challenge: string) => {
    try {
      const event: Event = {
        kind: 22242,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['relay', url], ['challenge', challenge]],
        content: '',
        id: '',
        sig: '',
      };
      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);
      await relay.auth(event);
      authResolve();
    } catch (e) {
      authReject(e as Error);
    }
  });

  await relay.connect();
  await Promise.race([
    authed,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('auth timeout (5s)')), 5000)),
  ]);

  return {
    relay,
    authedPubkey: pubkey,
    close: () => { try { relay.close(); } catch {} },
  };
}

// Sign + publish a community-level event to the live relay.
export async function publishLive(
  live: LiveRelay,
  privateKey: string,
  draft: { kind: number; content: string; tags: string[][] },
): Promise<Event> {
  const event: Event = {
    kind: draft.kind,
    pubkey: live.authedPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: draft.tags,
    content: draft.content,
    id: '',
    sig: '',
  };
  event.id = getEventHash(event);
  event.sig = getSignature(event, privateKey);
  await live.relay.publish(event);
  return event;
}
