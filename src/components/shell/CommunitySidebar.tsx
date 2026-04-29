// Channel sidebar for live NIP-29 communities. Reads the community state
// from the store; renders categories collapsibles + channels with type
// indicators and lock icons for unreadable channels.
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore, useLive, useLiveError, useLiveStatus } from '../../stores/store';
import {
  canReadChannel, memberHasPermission, type ChannelDef,
} from '../../stores/community-types';

interface CommunitySidebarProps {
  groupId: string;
  publicKey: string;
  onCreateChannel: () => void;
  onEditCommunity: () => void;
}

function ChannelIcon({ ch, locked }: { ch: ChannelDef; locked: boolean }) {
  if (locked) return <span aria-hidden>🔒</span>;
  switch (ch.type) {
    case 'voice':       return <span aria-hidden>🔊</span>;
    case 'encrypted':   return <span aria-hidden>🔐</span>;
    case 'announcement':return <span aria-hidden>📢</span>;
    default:            return <span aria-hidden>#</span>;
  }
}

export default function CommunitySidebar({
  groupId, publicKey, onCreateChannel, onEditCommunity,
}: CommunitySidebarProps) {
  const live = useLive(groupId);
  const liveStatus = useLiveStatus(groupId);
  const liveError = useLiveError(groupId);
  const collapsed = useAppStore((s) => s.collapsedCategories);
  const toggleCollapsed = useAppStore((s) => s.toggleCategoryCollapsed);
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId?: string }>();

  const isOwner = live.metadata?.ownerPubkey === publicKey;
  const canManageChannels = memberHasPermission(live, publicKey, 'manage_channels');

  const grouped = useMemo(() => {
    type Group = { category: { id: string; name: string; position: number } | null; channels: ChannelDef[] };
    const byId = new Map<string, Group>();
    for (const cat of live.categories) {
      byId.set(cat.id, { category: cat, channels: [] });
    }
    const uncategorized: Group = { category: null, channels: [] };
    for (const ch of live.channels) {
      if (ch.categoryId && byId.has(ch.categoryId)) {
        byId.get(ch.categoryId)!.channels.push(ch);
      } else {
        uncategorized.channels.push(ch);
      }
    }
    const groups = [
      ...(uncategorized.channels.length ? [uncategorized] : []),
      ...Array.from(byId.values()),
    ];
    for (const g of groups) g.channels.sort((a, b) => a.position - b.position);
    return groups;
  }, [live.categories, live.channels]);

  return (
    <div className="flex flex-col min-h-0 h-full overflow-y-auto">
      <header className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-color)] truncate">
            {live.metadata?.name ?? groupId}
          </div>
          {live.metadata?.about && (
            <div className="text-xs text-[var(--text-muted)] truncate" title={live.metadata.about}>
              {live.metadata.about}
            </div>
          )}
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={onEditCommunity}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-color)] px-2 py-1 rounded hover:bg-[var(--sidebar-hover)]"
            title="Editar comunidad"
          >
            ⚙
          </button>
        )}
      </header>

      {liveStatus !== 'ready' && (
        <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
          {liveStatus === 'error'
            ? <span className="text-red-400">Error: {liveError}</span>
            : `Conectando (${liveStatus})…`}
        </div>
      )}

      <ul className="px-1 py-2 flex-1">
        {grouped.map((g) => {
          const catId = g.category?.id ?? '__uncat__';
          const collapseKey = `${publicKey}::${groupId}::${catId}`;
          const isCollapsed = !!collapsed[collapseKey];
          return (
            <li key={catId} className="mb-2">
              {g.category && (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(collapseKey)}
                  className="w-full text-left px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)] flex items-center justify-between hover:text-[var(--text-color)]"
                >
                  <span>
                    <span className="inline-block w-3">{isCollapsed ? '▶' : '▼'}</span>{' '}
                    {g.category.name}
                  </span>
                  {canManageChannels && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); onCreateChannel(); }}
                      className="text-base leading-none px-1 hover:text-[var(--primary-color)]"
                      title="Crear canal"
                    >
                      +
                    </span>
                  )}
                </button>
              )}
              {!isCollapsed && (
                <ul>
                  {g.channels.map((ch) => {
                    const locked = !canReadChannel(live, publicKey, ch);
                    const active = ch.id === channelId;
                    return (
                      <li key={ch.id}>
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => navigate(`/c/${groupId}/${ch.id}`)}
                          className={`w-full text-left px-3 py-1 rounded text-sm flex items-center gap-2 ${
                            active ? 'bg-[var(--sidebar-hover)] text-[var(--text-color)]' : 'text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-color)]'
                          } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={locked ? 'Sin permiso para leer este canal' : ch.topic ?? ch.name}
                        >
                          <ChannelIcon ch={ch} locked={locked} />
                          <span className="truncate">{ch.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}

        {!grouped.length && liveStatus === 'ready' && (
          <li className="px-3 py-2 text-xs text-[var(--text-muted)]">
            Sin canales todavía.
          </li>
        )}
      </ul>

      {canManageChannels && (
        <div className="px-3 py-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onCreateChannel}
            className="w-full text-xs px-2 py-1.5 rounded border border-[var(--border-subtle)] hover:border-[var(--primary-color)] text-[var(--text-color)]"
          >
            + Crear canal
          </button>
        </div>
      )}
    </div>
  );
}
