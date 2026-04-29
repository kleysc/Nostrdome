// Modal opened by the server-bar "+" button. Two paths (Discord-equivalent):
//
//   1. "Tengo un invite" — paste a `https://<host>/invite/<token>` URL,
//      we decode it with src/lib/invite.ts, preview name/relay, and on
//      confirm navigate to /invite/<token> where InviteJoinView (§2.2.3)
//      runs the auth + membership checks.
//
//   2. "Crear nuevo" — link to the self-host bundle docs. Self-host is
//      the only way to spin a brand-new community in F2; an in-app
//      "create" wizard is post-v1 territory.
//
// Decoupled from any join logic on purpose: this component is pure UX,
// the real network work happens after navigation.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodeInviteToken } from '../../lib/invite';

interface AddServerModalProps {
  onClose: () => void;
}

const SELFHOST_DOCS_URL = 'https://github.com/nostrdome-platform/nostrdome#self-host';

export default function AddServerModal({ onClose }: AddServerModalProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'invite' | 'create'>('invite');
  const [inviteInput, setInviteInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Decode lazily so the preview reacts to typing.
  const preview = inviteInput.trim() ? decodeInviteToken(inviteInput) : null;
  const inputLooksLikeAttempt = inviteInput.trim().length > 0;
  const showInvalid = inputLooksLikeAttempt && !preview;

  function handleAccept() {
    setError(null);
    const payload = decodeInviteToken(inviteInput);
    if (!payload) {
      setError('El invite no es válido. Pegá la URL completa que recibiste.');
      return;
    }
    // Re-derive the canonical token from the input. We accept full URLs,
    // bare paths, or just the token; the route only needs the token segment.
    const idx = inviteInput.indexOf('/invite/');
    const tokenSegment = idx >= 0
      ? inviteInput.slice(idx + '/invite/'.length).split(/[?#]/, 1)[0]!.trim()
      : inviteInput.trim();
    navigate(`/invite/${tokenSegment}`);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full rounded-lg border border-[var(--border-subtle)] shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--header-bg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-5 pb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-color)]">Añadir servidor</h2>
          <button type="button" onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-color)] text-lg leading-none px-2"
            aria-label="Cerrar">✕</button>
        </header>

        <div className="px-5">
          <div role="tablist" className="flex gap-1 border-b border-[var(--border-subtle)] -mx-5 px-5">
            <button type="button" role="tab" aria-selected={tab === 'invite'}
              onClick={() => setTab('invite')}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === 'invite'
                  ? 'border-[var(--primary-color)] text-[var(--text-color)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-color)]'
              }`}>
              Tengo un invite
            </button>
            <button type="button" role="tab" aria-selected={tab === 'create'}
              onClick={() => setTab('create')}
              className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                tab === 'create'
                  ? 'border-[var(--primary-color)] text-[var(--text-color)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-color)]'
              }`}>
              Crear nuevo
            </button>
          </div>
        </div>

        {tab === 'invite' ? (
          <div className="p-5 space-y-3">
            <label className="block text-sm text-[var(--text-color)]">
              URL del invite
              <input
                value={inviteInput}
                onChange={(e) => { setInviteInput(e.target.value); setError(null); }}
                placeholder="https://comunidad.ejemplo/invite/…"
                autoFocus
                className="mt-1 w-full px-2 py-1.5 rounded bg-transparent border border-[var(--border-subtle)] text-sm font-mono"
              />
            </label>
            {preview && (
              <div className="rounded border border-[var(--border-subtle)] p-3 text-sm">
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  Vista previa
                </div>
                <div className="text-[var(--text-color)] font-medium truncate" title={preview.name ?? preview.groupId}>
                  {preview.name ?? preview.groupId}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate" title={preview.relayUrl}>
                  {preview.relayUrl}
                </div>
                {preview.redemptionToken && (
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-400">
                    Incluye token de redención
                  </div>
                )}
              </div>
            )}
            {showInvalid && (
              <p className="text-sm text-red-400">
                No reconozco este invite. Asegurate de pegar la URL completa.
              </p>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
                Cancelar
              </button>
              <button type="button" onClick={handleAccept} disabled={!preview}
                className="px-3 py-1.5 rounded text-sm bg-[var(--primary-color)] text-white disabled:opacity-50">
                Continuar
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-3 text-sm text-[var(--text-color)]">
            <p>
              Crear una comunidad nueva requiere alojar un relay propio. El
              cliente no genera comunidades en relays de terceros — la idea
              es que vos seas dueño de tu infraestructura.
            </p>
            <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)]">
              <li>VPS de 2-4GB para empezar (4-8GB con voz).</li>
              <li><code>docker compose up -d</code> con el bundle.</li>
              <li>Apuntás un dominio, corrés <code>install.sh</code>.</li>
              <li>El bundle te da una URL de invite para tu owner npub.</li>
            </ul>
            <a href={SELFHOST_DOCS_URL} target="_blank" rel="noreferrer"
              className="inline-block px-3 py-1.5 rounded text-sm bg-[var(--primary-color)] text-white">
              Abrir guía de self-host ↗
            </a>
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onClose}
                className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
