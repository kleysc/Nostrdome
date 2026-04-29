import { useState } from 'react';
import { useAppStore, useLive } from '../../stores/store';
import { publishLive, type LiveRelay } from '../../lib/live-relay';

interface CreateChannelModalProps {
  groupId: string;
  liveRelay: LiveRelay;
  privateKey: string;
  onClose: () => void;
}

// Minimal "Crear canal" modal: name, category, type, write_roles, read_roles.
// Publishes a kind 39100 event signed by the admin (relay rejects if signer
// doesn't have manage_channels — checked via §1.2.5 in real plugin; the
// spike accepts any member's write currently).
export default function CreateChannelModal({ groupId, liveRelay, privateKey, onClose }: CreateChannelModalProps) {
  const live = useLive(groupId);
  const upsertLiveChannel = useAppStore((s) => s.upsertLiveChannel);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>(live.categories[0]?.id ?? '');
  const [type, setType] = useState<'text' | 'voice' | 'announcement' | 'encrypted'>('text');
  const [topic, setTopic] = useState('');
  const [writeRoles, setWriteRoles] = useState('everyone');
  const [readRoles, setReadRoles] = useState('everyone');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const id = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32) || `ch-${Date.now()}`;
    try {
      // Audit trail FIRST (kind 39250). The relay rejects state mutations
      // unless preceded by a recent audit event from the same actor for
      // the same group (§1.2.8).
      await publishLive(liveRelay, privateKey, {
        kind: 39250,
        content: JSON.stringify({ action: 'channel_create', target: id }),
        tags: [['h', groupId], ['action', 'channel_create'], ['target', id]],
      });
      await publishLive(liveRelay, privateKey, {
        kind: 39100,
        content: JSON.stringify({
          name: name.trim(),
          category_id: categoryId || undefined,
          type,
          topic: topic.trim() || undefined,
          position: live.channels.length,
          write_roles: writeRoles.split(',').map((s) => s.trim()).filter(Boolean),
          read_roles: readRoles.split(',').map((s) => s.trim()).filter(Boolean),
        }),
        tags: [['d', id], ['h', groupId]],
      });
      // Optimistic: also reflect locally so UI updates without waiting for echo
      upsertLiveChannel(groupId, {
        id,
        name: name.trim(),
        categoryId: categoryId || undefined,
        type,
        topic: topic.trim() || undefined,
        position: live.channels.length,
        writeRoles: writeRoles.split(',').map((s) => s.trim()).filter(Boolean),
        readRoles: readRoles.split(',').map((s) => s.trim()).filter(Boolean),
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
        <h2 className="text-lg font-semibold text-[var(--text-color)]">Crear canal</h2>
        <label className="block text-sm text-[var(--text-color)]">
          Nombre
          <input
            value={name} onChange={(e) => setName(e.target.value)} required maxLength={32}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
            placeholder="ej. anuncios"
          />
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          Categoría
          <select
            value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
          >
            <option value="">(sin categoría)</option>
            {live.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          Tipo
          <select
            value={type} onChange={(e) => setType(e.target.value as 'text' | 'voice' | 'announcement' | 'encrypted')}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
          >
            <option value="text">text</option>
            <option value="announcement">announcement</option>
            <option value="voice">voice (F4)</option>
            <option value="encrypted">encrypted (F3)</option>
          </select>
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          Tema (opcional)
          <input
            value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
          />
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          write_roles (coma)
          <input
            value={writeRoles} onChange={(e) => setWriteRoles(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
            placeholder="everyone, Staff"
          />
        </label>
        <label className="block text-sm text-[var(--text-color)]">
          read_roles (coma)
          <input
            value={readRoles} onChange={(e) => setReadRoles(e.target.value)}
            className="mt-1 w-full px-2 py-1 rounded bg-transparent border border-[var(--border-subtle)]"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-[var(--text-muted)] hover:text-[var(--text-color)]">
            Cancelar
          </button>
          <button type="submit" disabled={submitting || !name.trim()}
            className="px-3 py-1.5 rounded text-sm bg-[var(--primary-color)] text-white disabled:opacity-50">
            {submitting ? 'Publicando…' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
