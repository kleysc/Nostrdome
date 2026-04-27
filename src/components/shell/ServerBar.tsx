import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServers, type ServerEntry } from '../../stores/servers';
import { liveGroupId, liveRelayUrl } from '../../config';
import AddServerModal from './AddServerModal';
import UserMenu from './UserMenu';

interface ServerBarProps {
  publicKey: string | null;
  onOpenProfile: () => void;
  onLogout: () => void;
}

// F2 server bar: renders every joined community, supports drag-to-reorder,
// right-click context menu (mute / mark read / leave), and hover tooltip.
// One legacy entry is auto-bootstrapped from runtime config so first-time
// users see their default community.
export default function ServerBar({ publicKey, onOpenProfile, onLogout }: ServerBarProps) {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  // One selector per field — returning an object literal here would mint a
  // new reference on every store update and trigger infinite re-renders
  // under Zustand v5's Object.is equality.
  const servers = useServers((s) => s.servers);
  const activeGroupId = useServers((s) => s.activeGroupId);
  const unreadCounts = useServers((s) => s.unreadCounts);
  const add = useServers((s) => s.add);
  const markRead = useServers((s) => s.markRead);
  const reorder = useServers((s) => s.reorder);
  const remove = useServers((s) => s.remove);
  const toggleMuted = useServers((s) => s.toggleMuted);

  // Bootstrap: if the user has zero joined servers but a runtime config
  // points at one, add it transparently. Subsequent edits to that config
  // don't re-bootstrap (the user has agency over their list now).
  useEffect(() => {
    if (servers.length === 0 && liveRelayUrl && liveGroupId) {
      add({
        groupId: liveGroupId,
        relayUrl: liveRelayUrl,
        name: 'Nostrdome',
      });
    }
  }, [servers.length, add]);

  // Right-click context menu state. We render at most one menu at a time.
  const [ctxMenu, setCtxMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [ctxMenu]);

  const sorted = [...servers].sort((a, b) => a.sortIndex - b.sortIndex);

  return (
    <nav
      aria-label="Servidores"
      className="w-14 shrink-0 flex flex-col items-center py-3 gap-2 border-r border-[var(--border-subtle)]"
      style={{ backgroundColor: 'var(--header-bg)' }}
    >
      {sorted.map((s) => (
        <ServerIcon
          key={s.groupId}
          server={s}
          active={s.groupId === activeGroupId}
          unread={unreadCounts[s.groupId] ?? 0}
          onClick={() => {
            markRead(s.groupId);
            navigate(`/c/${s.groupId}`);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu({ groupId: s.groupId, x: e.clientX, y: e.clientY });
          }}
          onDropBefore={(sourceGroupId) => reorder(sourceGroupId, s.groupId)}
        />
      ))}

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="w-10 h-10 rounded-2xl hover:rounded-xl transition-all border border-dashed border-[var(--border-subtle)] hover:border-[var(--primary-color)] text-[var(--text-muted)] hover:text-[var(--primary-color)] flex items-center justify-center text-xl"
        title="Añadir servidor"
        aria-label="Añadir servidor"
      >
        +
      </button>

      <UserMenu publicKey={publicKey} onOpenProfile={onOpenProfile} onLogout={onLogout} />

      {addOpen && <AddServerModal onClose={() => setAddOpen(false)} />}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onMarkRead={() => { markRead(ctxMenu.groupId); setCtxMenu(null); }}
          onToggleMuted={() => { toggleMuted(ctxMenu.groupId); setCtxMenu(null); }}
          onLeave={() => {
            if (confirm('¿Salir del servidor? La lista se perderá del bar pero los eventos en el relay no se borran.')) {
              remove(ctxMenu.groupId);
            }
            setCtxMenu(null);
          }}
          muted={servers.find((s) => s.groupId === ctxMenu.groupId)?.muted ?? false}
        />
      )}
    </nav>
  );
}

interface ServerIconProps {
  server: ServerEntry;
  active: boolean;
  unread: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDropBefore: (sourceGroupId: string) => void;
}

function ServerIcon({ server, active, unread, onClick, onContextMenu, onDropBefore }: ServerIconProps) {
  const initial = (server.name || server.groupId).slice(0, 1).toUpperCase();
  // Unread badge convention: hide on the active or muted icon (the user
  // either is reading or opted out of notifications). The bumpUnread
  // setter in the slice already skips the active one, but checking here
  // too keeps the render correct on the first frame after a switch.
  const showBadge = !active && !server.muted && unread > 0;
  const badgeLabel = unread > 99 ? '99+' : String(unread);
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', server.groupId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const src = e.dataTransfer.getData('text/plain');
        if (src && src !== server.groupId) onDropBefore(src);
      }}
      className={[
        'relative w-10 h-10 transition-all flex items-center justify-center font-bold',
        active ? 'rounded-xl' : 'rounded-2xl hover:rounded-xl',
        active ? 'bg-[var(--primary-color)] text-white' : 'bg-[var(--bg-secondary,rgba(255,255,255,0.05))] text-[var(--text-color)]',
      ].join(' ')}
      title={server.muted ? `${server.name} (silenciado)` : server.name}
      aria-label={
        showBadge ? `${server.name}, ${unread} sin leer` : server.name
      }
      aria-current={active ? 'true' : undefined}
    >
      {server.picture
        ? <img src={server.picture} alt="" className="w-full h-full rounded-[inherit] object-cover" />
        : initial}
      {server.muted && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[var(--text-muted)]" aria-hidden />
      )}
      {showBadge && (
        <span
          className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2"
          style={{ borderColor: 'var(--header-bg)' }}
          aria-hidden
        >
          {badgeLabel}
        </span>
      )}
    </button>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  muted: boolean;
  onMarkRead: () => void;
  onToggleMuted: () => void;
  onLeave: () => void;
}

function ContextMenu({ x, y, muted, onMarkRead, onToggleMuted, onLeave }: ContextMenuProps) {
  return (
    <ul
      role="menu"
      className="fixed z-50 min-w-[160px] rounded-md border border-[var(--border-subtle)] py-1 text-sm shadow-xl"
      style={{ left: x, top: y, backgroundColor: 'var(--header-bg)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <li>
        <button onClick={onMarkRead} className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white">
          Marcar como leído
        </button>
      </li>
      <li>
        <button onClick={onToggleMuted} className="w-full text-left px-3 py-1.5 hover:bg-[var(--primary-color)] hover:text-white">
          {muted ? 'Activar notificaciones' : 'Silenciar notificaciones'}
        </button>
      </li>
      <li>
        <button onClick={onLeave} className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-500 hover:text-white">
          Salir del servidor
        </button>
      </li>
    </ul>
  );
}
