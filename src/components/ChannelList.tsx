import React, { useState } from 'react';
import { SimplePool, getEventHash, getSignature, Event } from 'nostr-tools';
import { relayUrls } from '../config';
import type { Channel } from '../App';

interface ChannelListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string | null) => void;
  pool: SimplePool;
  privateKey: string;
  publicKey: string;
  onChannelCreated: () => void;
}

const ChannelList: React.FC<ChannelListProps> = ({
  channels,
  selectedChannelId,
  onSelectChannel,
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
    <div className="shrink-0 flex flex-col min-h-0 bg-gray-900/80 max-h-[40%]">
      <div className="shrink-0 p-3">
        <h2 className="text-sm font-bold mb-2 opacity-80">Canales</h2>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="text-left p-2 rounded mb-1 text-sm w-full hover:bg-gray-800 border border-dashed border-gray-600"
        >
          ＋ Crear canal
        </button>
        <button
          type="button"
          onClick={() => onSelectChannel(null)}
          className={`text-left p-2 rounded mb-1 text-sm w-full ${selectedChannelId === null && !showCreate ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
        >
          📡 Feed y DMs
        </button>
      </div>
      {showCreate && (
        <div className="shrink-0 p-3 border-t border-gray-700">
          <form onSubmit={handleCreateChannel} className="space-y-2">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Nombre del canal"
              className="w-full bg-gray-800 text-current p-2 rounded text-sm"
            />
            <input
              type="text"
              value={createAbout}
              onChange={(e) => setCreateAbout(e.target.value)}
              placeholder="Descripción (opcional)"
              className="w-full bg-gray-800 text-current p-2 rounded text-sm"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 bg-green-700 text-white py-1.5 rounded text-sm disabled:opacity-50"
              >
                {creating ? 'Creando…' : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setError(''); }}
                className="px-2 py-1.5 rounded text-sm hover:bg-gray-700"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 p-3 pt-0">
        {channels.map((ch) => (
          <button
            key={ch.id}
            type="button"
            onClick={() => onSelectChannel(ch.id)}
            className={`w-full text-left p-2 rounded text-sm flex items-center gap-2 ${
              selectedChannelId === ch.id ? 'bg-gray-700' : 'hover:bg-gray-800'
            }`}
          >
            {ch.picture ? (
              <img src={ch.picture} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded bg-gray-600 flex items-center justify-center text-xs shrink-0">#</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{ch.name}</div>
              {ch.about && <div className="text-xs text-gray-400 truncate">{ch.about}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChannelList;
