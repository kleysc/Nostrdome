import { useState } from 'react';
import { useAppStore, useLive } from '../../stores/store';
import { publishLive, type LiveRelay } from '../../lib/live-relay';

interface EditCommunityModalProps {
  groupId: string;
  liveRelay: LiveRelay;
  privateKey: string;
  publicKey: string;
  onClose: () => void;
}

export default function EditCommunityModal({
  groupId, liveRelay, privateKey, publicKey, onClose,
}: EditCommunityModalProps) {
  const live = useLive(groupId);
  const applyLiveMetadata = useAppStore((s) => s.applyLiveMetadata);
  const [name, setName] = useState(live.metadata?.name ?? '');
  const [picture, setPicture] = useState(live.metadata?.picture ?? '');
  const [about, setAbout] = useState(live.metadata?.about ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Audit FIRST (kind 39250) per §1.2.8 — the relay rejects state
      // mutations not preceded by a recent audit event.
      await publishLive(liveRelay, privateKey, {
        kind: 39250,
        content: JSON.stringify({ action: 'metadata_change', target: groupId }),
        tags: [['h', groupId], ['action', 'metadata_change'], ['target', groupId]],
      });
      await publishLive(liveRelay, privateKey, {
        kind: 39000,
        content: JSON.stringify({
          name: name.trim(),
          picture: picture.trim() || undefined,
          about: about.trim() || undefined,
          owner_pubkey: publicKey,
        }),
        tags: [['d', groupId]],
      });
      applyLiveMetadata(groupId, {
        groupId,
        name: name.trim(),
        picture: picture.trim() || undefined,
        about: about.trim() || undefined,
        ownerPubkey: publicKey,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-w-sm w-full rounded-lg border border-[var(--border-subtle)] p-5 shadow-xl space-y-3"
        style={{ backgroundColor: 'var(--header-bg)' }}
      >
        <h2 className="text-lg font-semibold text-[var(--text-color)]">Editar comunidad</h2>
        <label className="block text-sm text-[var(--text-color)]">
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]" />
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          Picture URL (opcional)
          <input value={picture} onChange={(e) => setPicture(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
            placeholder="https://…" />
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          About (opcional)
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} maxLength={300}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]" />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
            Cancelar
          </button>
          <button type="submit" disabled={submitting || !name.trim()}
            className="px-3 py-1.5 rounded text-sm bg-[var(--primary-color)] text-white disabled:opacity-50">
            {submitting ? 'Publicando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
