// Invite URL encoding for the F2 multi-server flow (§2.2.2).
//
// An invite is a self-contained payload that lets a fresh client (no prior
// config, no relay knowledge) join a Nostrdome community by clicking one
// link. The shape:
//
//   https://<host>/invite/<token>
//
// where `<token>` is the base64url-encoded JSON form of InvitePayload.
//
// Why self-contained vs server-side lookup:
//   • No central directory to host token → community mappings.
//   • The host in the URL is the community's web origin (where the SPA
//     lives) but the actual relay can be elsewhere — encoding both lets
//     the receiving client connect without an extra hop.
//   • Token is opaque to anyone without the URL, but anyone with the URL
//     reads its content. That's by design — it's an invitation, not a
//     credential. Real one-shot redemption (kind 39270) layers on top.

export interface InvitePayload {
  /** ws/wss URL of the NIP-29 relay hosting the community. */
  relayUrl: string;
  /** Group id (the `d` tag of kind 39000 / `h` tag of operational events). */
  groupId: string;
  /** Optional human-readable label for the join modal preview. */
  name?: string;
  /** Optional avatar URL for the join modal preview. */
  picture?: string;
  /**
   * Optional one-shot redemption token. When present the client posts it
   * to the relay's invite endpoint (TODO §1.7 / F2.x) so a non-member
   * pubkey can be added to kind 39002 by the relay on the inviter's
   * behalf. When absent the invite assumes the recipient is already in
   * the member list (admin pre-added them).
   */
  redemptionToken?: string;
}

const PREFIX = '/invite/';

// base64url <-> string (browser-safe). We avoid the URL-unsafe characters
// `+` and `/` so the token survives history.pushState and copy-paste in
// chat clients.
function b64urlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(token: string): string {
  // Re-pad to a multiple of 4 so atob accepts it.
  const pad = token.length % 4 === 0 ? '' : '='.repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Encode an invite payload into a `<host>/invite/<token>` URL.
 * Pass `host` as the SPA origin; for a self-contained invite intended to
 * be opened by THIS client, the caller can use `window.location.origin`.
 */
export function encodeInvite(host: string, payload: InvitePayload): string {
  if (!payload.relayUrl || !payload.groupId) {
    throw new Error('encodeInvite: relayUrl and groupId are required');
  }
  const json = JSON.stringify(payload);
  const token = b64urlEncode(json);
  // Strip any trailing slash on host so we don't end up with `///invite/`.
  const cleanHost = host.replace(/\/+$/, '');
  return `${cleanHost}${PREFIX}${token}`;
}

/**
 * Decode the token segment of an invite URL.
 * Accepts either the bare token, the path (`/invite/<token>`), or the
 * full URL — callers don't have to pre-clean the input from a paste box.
 * Returns null on any parse / validation failure.
 */
export function decodeInviteToken(input: string): InvitePayload | null {
  if (!input) return null;
  const trimmed = input.trim();
  // Pull out just the token segment regardless of input shape.
  let token = trimmed;
  const idx = trimmed.indexOf(PREFIX);
  if (idx >= 0) token = trimmed.slice(idx + PREFIX.length);
  // Drop any trailing query / hash, defensively.
  token = token.split(/[?#]/, 1)[0]!;
  if (!token) return null;
  try {
    const json = b64urlDecode(token);
    const obj = JSON.parse(json) as Partial<InvitePayload>;
    if (typeof obj.relayUrl !== 'string' || typeof obj.groupId !== 'string') return null;
    if (!obj.relayUrl.startsWith('ws://') && !obj.relayUrl.startsWith('wss://')) return null;
    return {
      relayUrl: obj.relayUrl,
      groupId: obj.groupId,
      name: typeof obj.name === 'string' ? obj.name : undefined,
      picture: typeof obj.picture === 'string' ? obj.picture : undefined,
      redemptionToken: typeof obj.redemptionToken === 'string' ? obj.redemptionToken : undefined,
    };
  } catch {
    return null;
  }
}
