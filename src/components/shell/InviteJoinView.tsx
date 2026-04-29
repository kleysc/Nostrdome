// Route element for `/invite/:token` (§2.2.3 + §2.2.4).
//
// Decodes the invite payload, connects+auths to the embedded relay,
// queries kind 39000 (group metadata, for the human-readable name) and
// kind 39002 (members, to check whether the inviter pre-added us). On
// success: registers the server in `useServers` and navigates to the
// community. On failure: shows actionable messaging — the user can ask
// for a real invite, retry, or go back.
//
// Token-based redemption (calling the relay's `/invite/<token>` HTTP
// endpoint to add ourselves to kind 39002) is documented inline as a
// stub; the endpoint lands with §1.7.x bundle work. Until then a payload
// without prior membership shows "esperá a un admin".
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Event } from 'nostr-tools';
import { connectAndAuth, type LiveRelay } from '../../lib/live-relay';
import { decodeInviteToken, type InvitePayload } from '../../lib/invite';
import { useServers } from '../../stores/servers';
import { useAppStore } from '../../stores/store';

type Phase =
  | { kind: 'decoding' }
  | { kind: 'invalid' }
  | { kind: 'connecting'; payload: InvitePayload }
  | { kind: 'syncing'; payload: InvitePayload }
  | { kind: 'joined'; payload: InvitePayload }
  | { kind: 'pending'; payload: InvitePayload }
  | { kind: 'error'; payload: InvitePayload | null; message: string };

const SYNC_TIMEOUT_MS = 8000;

export default function InviteJoinView() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const privateKey = useAppStore((s) => s.privateKey);
  const publicKey = useAppStore((s) => s.publicKey);
  const addServer = useServers((s) => s.add);
  const existingServers = useServers((s) => s.servers);
  const setActive = useServers((s) => s.setActive);

  const [phase, setPhase] = useState<Phase>({ kind: 'decoding' });

  useEffect(() => {
    let cancelled = false;
    let live: LiveRelay | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      if (!privateKey || !publicKey) {
        // The router guards `/c/...` but `/invite/...` is reachable while
        // logged out. Punt to /login and let RootLayout's redirect bring
        // us back via location state once auth is in place.
        navigate('/login', { replace: true });
        return;
      }
      const payload = decodeInviteToken(token);
      if (!payload) {
        if (!cancelled) setPhase({ kind: 'invalid' });
        return;
      }

      // Already joined? Skip the relay round-trip.
      const already = existingServers.find((s) => s.groupId === payload.groupId);
      if (already) {
        setActive(payload.groupId);
        navigate(`/c/${payload.groupId}`, { replace: true });
        return;
      }

      if (!cancelled) setPhase({ kind: 'connecting', payload });
      try {
        live = await connectAndAuth(payload.relayUrl, privateKey);
      } catch (err) {
        if (!cancelled) setPhase({
          kind: 'error',
          payload,
          message: `No pude conectar al relay: ${(err as Error).message}`,
        });
        return;
      }
      if (cancelled) { live.close(); return; }

      if (!cancelled) setPhase({ kind: 'syncing', payload });

      // Resolve once we know whether we're a member. We listen to BOTH
      // kind 39000 (for the canonical name/picture, in case the invite's
      // hints are stale) and 39002 (membership). Whichever EOSE arrives
      // first that gives us membership info wins; a hard timeout falls
      // back to "pending".
      let membershipKnown = false;
      let metadataName = payload.name;
      let metadataPicture = payload.picture;

      const metaSub = live.relay.sub([{ kinds: [39000], '#d': [payload.groupId] }]);
      metaSub.on('event', (e: Event) => {
        try {
          const c = JSON.parse(e.content || '{}') as { name?: string; picture?: string };
          if (c.name) metadataName = c.name;
          if (c.picture) metadataPicture = c.picture;
        } catch { /* ignore */ }
      });

      const membersSub = live.relay.sub([{ kinds: [39002], '#d': [payload.groupId] }]);
      let isMember = false;
      membersSub.on('event', (e: Event) => {
        try {
          const c = JSON.parse(e.content || '{}') as {
            members?: Array<{ pubkey: string }>;
          };
          if (c.members?.some((m) => m.pubkey === publicKey)) isMember = true;
        } catch { /* ignore */ }
      });

      const settle = () => {
        if (cancelled || membershipKnown) return;
        membershipKnown = true;
        try { metaSub.unsub(); } catch {}
        try { membersSub.unsub(); } catch {}

        if (isMember) {
          addServer({
            groupId: payload.groupId,
            relayUrl: payload.relayUrl,
            name: metadataName ?? payload.groupId,
            picture: metadataPicture,
          });
          setActive(payload.groupId);
          setPhase({ kind: 'joined', payload });
          // Brief pause so the user sees the "Listo" state, then route in.
          timers.push(setTimeout(() => {
            if (!cancelled) navigate(`/c/${payload.groupId}`, { replace: true });
          }, 400));
        } else if (payload.redemptionToken) {
          // TODO §1.7: POST payload.redemptionToken to
          //   <derived from relayUrl>/invite/<token>
          // with NIP-98 auth. The endpoint adds publicKey to kind 39002
          // and returns 200. Until that endpoint exists, the recipient
          // still needs an admin to add them by hand.
          setPhase({ kind: 'pending', payload });
        } else {
          setPhase({ kind: 'pending', payload });
        }
      };

      // Settle on the SECOND EOSE so we've heard from both subs (or
      // whichever timed out). The membership sub is the load-bearing one.
      let eoseCount = 0;
      const onEose = () => {
        eoseCount += 1;
        if (eoseCount >= 2) settle();
      };
      metaSub.on('eose', onEose);
      membersSub.on('eose', onEose);
      timers.push(setTimeout(settle, SYNC_TIMEOUT_MS));
    })();

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      if (live) live.close();
    };
  }, [token, privateKey, publicKey, navigate, addServer, setActive, existingServers]);

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-lg border border-[var(--border-subtle)] p-6 text-center space-y-3"
        style={{ backgroundColor: 'var(--header-bg)' }}>
        <PhaseView phase={phase} onCancel={() => navigate('/c/legacy', { replace: true })} />
      </div>
    </div>
  );
}

function PhaseView({ phase, onCancel }: { phase: Phase; onCancel: () => void }) {
  switch (phase.kind) {
    case 'decoding':
      return <Spinner label="Procesando invite…" />;
    case 'invalid':
      return (
        <>
          <h2 className="text-base font-semibold text-[var(--text-color)]">Invite inválido</h2>
          <p className="text-sm text-[var(--text-muted)]">
            La URL no contiene un payload reconocible. Pediselo de nuevo a quien te invitó.
          </p>
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm bg-[var(--primary-color)] text-white">
            Volver
          </button>
        </>
      );
    case 'connecting':
      return <Spinner label={`Conectando a ${shortenRelay(phase.payload.relayUrl)}…`} />;
    case 'syncing':
      return <Spinner label={`Sincronizando ${phase.payload.name ?? phase.payload.groupId}…`} />;
    case 'joined':
      return (
        <>
          <h2 className="text-base font-semibold text-[var(--text-color)]">¡Listo!</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Te uniste a {phase.payload.name ?? phase.payload.groupId}. Redirigiendo…
          </p>
        </>
      );
    case 'pending':
      return (
        <>
          <h2 className="text-base font-semibold text-[var(--text-color)]">Esperando aprobación</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Todavía no estás en la lista de miembros de {phase.payload.name ?? phase.payload.groupId}.
            Pedile a un admin que te agregue con tu npub.
          </p>
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
            Volver
          </button>
        </>
      );
    case 'error':
      return (
        <>
          <h2 className="text-base font-semibold text-red-400">Error</h2>
          <p className="text-sm text-[var(--text-muted)]">{phase.message}</p>
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
            Volver
          </button>
        </>
      );
  }
}

function Spinner({ label }: { label: string }) {
  return (
    <>
      <div className="flex justify-center" aria-hidden>
        <span className="inline-block w-6 h-6 rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--primary-color)] animate-spin" />
      </div>
      <p className="text-sm text-[var(--text-muted)]">{label}</p>
    </>
  );
}

function shortenRelay(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
