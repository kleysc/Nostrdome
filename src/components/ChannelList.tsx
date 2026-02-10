import React, { useState } from 'react';
import { SimplePool, getEventHash, getSignature, Event } from 'nostr-tools';
import { relayUrls } from '../config';
import type { Channel } from '../App';

interface ChannelListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  unifiedFeed: boolean;
  onSelectChannel: (channelId: string | null) => void;
  onSelectUnified: () => void;
  pool: SimplePool;
  privateKey: string;
  publicKey: string;
  onChannelCreated: () => void;
}

const ChannelList: React.FC<ChannelListProps> = ({
  channels,
  selectedChannelId,
  unifiedFeed,
  onSelectChannel,
  onSelectUnified,
  pool,
  privateKey,
  publicKey,
  onChannelCreated,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAbout, setCreateAbout] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [channelsExpanded, setChannelsExpanded] = useState(true);

  const searchLower = channelSearch.trim().toLowerCase();
  const filteredChannels = searchLower
    ? channels.filter(
        (ch) =>
          ch.name.toLowerCase().includes(searchLower) ||
          (ch.about?.toLowerCase().includes(searchLower) ?? false)
      )
    : channels;

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) {
      setError('El nombre es obligatorio');
      return;
    }
    setError('');
    setCreating(true);
    try {
      const content = JSON.stringify({
        name,
        about: createAbout.trim() || undefined,
        relays: relayUrls,
      });
      const event: Event = {
        kind: 40,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content,
        id: '',
        sig: '',
      };
      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);
      await pool.publish(relayUrls, event);
      setShowCreate(false);
      setCreateName('');
      setCreateAbout('');
      onChannelCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el canal');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 p-3">
        <h2 className="sidebar-heading">Canales</h2>
        <button
          type="button"
          onClick={onSelectUnified}
          className={`sidebar-item w-full text-left py-2 px-3 rounded text-sm text-[var(--text-color)] ${unifiedFeed ? 'active' : ''}`}
        >
          📋 Todo
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="sidebar-item w-full text-left py-2 px-3 rounded text-sm text-[var(--text-color)] border border-dashed border-[var(--border-subtle)] mb-1"
        >
          ＋ Crear canal
        </button>
        <button
          type="button"
          onClick={() => onSelectChannel(null)}
          className={`sidebar-item w-full text-left py-2 px-3 rounded text-sm text-[var(--text-color)] ${selectedChannelId === null && !unifiedFeed && !showCreate ? 'active' : ''}`}
        >
          📡 Feed y DMs
        </button>
      </div>

      {/* Buscar y listar canales disponibles */}
      <div className="shrink-0 px-3 pb-2">
        <input
          type="text"
          value={channelSearch}
          onChange={(e) => setChannelSearch(e.target.value)}
          placeholder="Buscar canales..."
          className="w-full px-3 py-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] placeholder-[var(--text-muted)] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]"
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Sección colapsable: Canales disponibles */}
        <div className="shrink-0 flex flex-col">
          <button
            type="button"
            onClick={() => setChannelsExpanded((e) => !e)}
            className="flex items-center justify-between w-full px-3 py-1.5 text-left hover:bg-[var(--sidebar-hover)] rounded group"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <svg
                className={`w-4 h-4 transition-transform shrink-0 ${channelsExpanded ? '' : '-rotate-90'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Canales disponibles
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCreate(true); }}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-color)] hover:bg-[var(--sidebar-active)] opacity-0 group-hover:opacity-100 transition-opacity"
              title="Añadir canal"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </button>
        </div>

        {channelsExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 px-2 pb-2">
            {filteredChannels.length === 0 ? (
              <p className="px-3 py-4 text-xs text-[var(--text-muted)]">
                {channelSearch.trim() ? 'Ningún canal coincide con la búsqueda.' : 'No hay canales aún.'}
              </p>
            ) : (
              filteredChannels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onSelectChannel(ch.id)}
                  className={`sidebar-item w-full text-left py-2 px-3 rounded text-sm flex items-center gap-2 text-[var(--text-color)] min-w-0 ${selectedChannelId === ch.id ? 'active' : ''}`}
                  title={ch.about ? `${ch.name}\n${ch.about}` : ch.name}
                >
                  {ch.picture ? (
                    <img src={ch.picture} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                  ) : (
                    <span className="w-5 h-5 rounded bg-[var(--sidebar-active)] flex items-center justify-center text-[10px] shrink-0 text-[var(--text-muted)] font-medium">#</span>
                  )}
                  <span className="min-w-0 truncate text-[var(--text-color)]">{ch.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="shrink-0 p-3 border-t border-[var(--border-subtle)]">
          <form onSubmit={handleCreateChannel} className="space-y-2">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Nombre del canal"
              className="w-full p-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
            <input
              type="text"
              value={createAbout}
              onChange={(e) => setCreateAbout(e.target.value)}
              placeholder="Descripción (opcional)"
              className="w-full p-2 rounded text-sm bg-[var(--input-bg)] text-[var(--text-color)] border border-[var(--border-subtle)]"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={creating} className="btn-primary flex-1 py-2 rounded text-sm disabled:opacity-50">
                {creating ? 'Creando…' : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setError(''); }}
                className="sidebar-item py-2 px-3 rounded text-sm text-[var(--text-color)]"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChannelList;
