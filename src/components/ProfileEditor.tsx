import React, { useState, useEffect } from 'react';
import { SimplePool, Event, getEventHash, getSignature } from 'nostr-tools';
import { relayUrls } from '../config';

export interface ProfileForm {
  name: string;
  display_name: string;
  nip05: string;
  about: string;
  picture?: string;
}

interface ProfileEditorProps {
  pool: SimplePool;
  privateKey: string;
  publicKey: string;
  currentProfile: { name?: string; display_name?: string; nip05?: string } | null;
  onSaved: (profile: ProfileForm) => void;
  onClose: () => void;
}

const ProfileEditor: React.FC<ProfileEditorProps> = ({
  pool,
  privateKey,
  publicKey,
  currentProfile,
  onSaved,
  onClose,
}) => {
  const [name, setName] = useState(currentProfile?.name ?? '');
  const [display_name, setDisplayName] = useState(currentProfile?.display_name ?? '');
  const [nip05, setNip05] = useState(currentProfile?.nip05 ?? '');
  const [about, setAbout] = useState('');
  const [picture, setPicture] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{ kinds: [0], authors: [publicKey], limit: 1 }]);
    sub.on('event', (event: Event) => {
      try {
        const d = JSON.parse(event.content || '{}');
        setName(d.name ?? '');
        setDisplayName(d.display_name ?? '');
        setNip05(d.nip05 ?? '');
        setAbout(d.about ?? '');
        setPicture(d.picture ?? '');
      } catch {}
    });
    sub.on('eose', () => sub.unsub());
    return () => sub.unsub();
  }, [pool, publicKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const content: Record<string, string> = {};
      if (name.trim()) content.name = name.trim();
      if (display_name.trim()) content.display_name = display_name.trim();
      if (nip05.trim()) content.nip05 = nip05.trim();
      if (about.trim()) content.about = about.trim();
      if (picture.trim()) content.picture = picture.trim();

      const event: Event = {
        kind: 0,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(content),
        id: '',
        sig: '',
      };
      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);
      await pool.publish(relayUrls, event);

      onSaved({
        name: content.name ?? '',
        display_name: content.display_name ?? '',
        nip05: content.nip05 ?? '',
        about: content.about ?? '',
        picture: content.picture,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      onKeyDown={handleBackdropKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Editar perfil"
      tabIndex={0}
    >
      <div
        className="bg-[var(--sidebar-bg)] border border-[var(--border-subtle)] rounded-lg shadow-xl max-w-md w-full p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-color)]">Mi perfil</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-muted)]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          Solo necesitas crear una clave (private key). Luego publica tu perfil (kind 0) para que aparezca tu nombre o NIP-05.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="profile-name" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Nombre (username)</label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ej. alice"
              className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
          </div>
          <div>
            <label htmlFor="profile-display-name" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Nombre para mostrar</label>
            <input
              id="profile-display-name"
              type="text"
              value={display_name}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ej. Alice"
              className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
          </div>
          <div>
            <label htmlFor="profile-nip05" className="block text-xs font-medium text-[var(--text-muted)] mb-1">NIP-05 (opcional)</label>
            <input
              id="profile-nip05"
              type="text"
              value={nip05}
              onChange={(e) => setNip05(e.target.value)}
              placeholder="usuario@dominio.com"
              className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
          </div>
          <div>
            <label htmlFor="profile-about" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Bio (opcional)</label>
            <textarea
              id="profile-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Una frase sobre ti"
              rows={2}
              className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)] resize-none"
            />
          </div>
          <div>
            <label htmlFor="profile-picture" className="block text-xs font-medium text-[var(--text-muted)] mb-1">Avatar URL (opcional)</label>
            <input
              id="profile-picture"
              type="url"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex-1 py-2 rounded text-sm disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Publicar perfil'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded text-sm text-[var(--text-color)] bg-[var(--sidebar-hover)]">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileEditor;
