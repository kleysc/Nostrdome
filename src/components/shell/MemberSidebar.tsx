// Right-hand member roster.
//
// Reads the live community + profile cache + presence map from the store,
// builds a flat row list (role headers + members), and renders virtualized
// with react-window. Designed to stay smooth at 1000+ members (one of the
// F1 GATE checks, §1.8.3).
//
// Hidden below md breakpoint (channel + chat take priority on small viewports).
import { useEffect, useMemo, useState } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { useAppStore, useGroupPresence, useLive, useLiveStatus } from '../../stores/store';
import { buildMemberRows, type MemberRow } from '../../lib/member-grouping';

const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 36;
// Re-evaluate online/offline split this often. 15s = half the heartbeat
// interval, so a member that went silent flips within ≤105s real time.
const TICK_MS = 15_000;

interface RowProps {
  rows: MemberRow[];
  selectedPubkey: string | null;
  onSelect: (pubkey: string) => void;
}

function Row({ index, style, rows, selectedPubkey, onSelect }: RowComponentProps<RowProps>) {
  const row = rows[index];
  if (!row) return null;

  if (row.type === 'header') {
    return (
      <div
        style={style}
        className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)] flex items-center gap-1"
        title={row.tooltip}
      >
        {row.badge && <span aria-hidden>{row.badge}</span>}
        <span style={row.color ? { color: row.color } : undefined}>{row.label}</span>
        <span className="opacity-60">— {row.count}</span>
      </div>
    );
  }

  const initial = row.displayName.charAt(0).toUpperCase() || '?';
  const picture = row.profile?.picture || row.member.pictureOverride;
  const isSelected = row.pubkey === selectedPubkey;

  return (
    <button
      type="button"
      style={style}
      onClick={() => onSelect(row.pubkey)}
      className={`w-full px-3 flex items-center gap-2 text-sm rounded-none ${
        isSelected
          ? 'bg-[var(--sidebar-hover)] text-[var(--text-color)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text-color)]'
      } ${row.online ? '' : 'opacity-60'}`}
      title={row.member.displayOverride ? `${row.displayName} · per-server nick` : row.displayName}
    >
      <span className="relative shrink-0">
        {picture ? (
          <img
            src={picture}
            alt=""
            className="w-6 h-6 rounded-full object-cover"
            loading="lazy"
            // Fallback if the URL 404s — don't keep retrying every render.
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        ) : (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
            style={{ backgroundColor: row.role?.color ?? 'var(--border-subtle)', color: '#fff' }}
            aria-hidden
          >
            {initial}
          </span>
        )}
        {row.online && (
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
            style={{ backgroundColor: '#22c55e', borderColor: 'var(--sidebar-bg, #1e1e1e)' }}
            aria-label="online"
          />
        )}
      </span>
      <span className="truncate flex-1 text-left" style={row.role?.color ? { color: row.role.color } : undefined}>
        {row.displayName}
      </span>
      {row.role?.badge && <span className="shrink-0 opacity-90" aria-hidden>{row.role.badge}</span>}
    </button>
  );
}

function rowHeight(index: number, props: RowProps): number {
  return props.rows[index]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT;
}

export default function MemberSidebar() {
  const isOpen = useAppStore((s) => s.isMemberSidebarOpen);
  // Read the active group from the store: the sidebar is rendered by
  // AppShell which doesn't carry route params. LiveCommunityView is
  // responsible for pushing setActiveGroup before this component reads.
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const live = useLive(activeGroupId);
  const profiles = useAppStore((s) => s.profiles);
  const presence = useGroupPresence(activeGroupId);
  const liveStatus = useLiveStatus(activeGroupId);
  const selected = useAppStore((s) => s.selectedMemberPubkey);
  const selectMember = useAppStore((s) => s.selectMember);

  // Tick state to re-evaluate online/offline windows. Cheap: just bumps a
  // number, the useMemo below handles the actual recomputation.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), TICK_MS);
    return () => window.clearInterval(i);
  }, []);

  const rows = useMemo(
    () => buildMemberRows({ state: live, profiles, presence, nowSec }),
    [live, profiles, presence, nowSec],
  );

  const onlineCount = useMemo(
    () => rows.reduce((acc, r) => acc + (r.type === 'member' && r.online ? 1 : 0), 0),
    [rows],
  );

  if (!isOpen) return null;

  return (
    <aside
      className="hidden md:flex w-60 shrink-0 flex-col min-h-0 border-l border-[var(--border-subtle)] sidebar-bg"
      aria-label="Miembros"
    >
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border-subtle)] flex items-center justify-between">
        <span>Miembros</span>
        <span className="opacity-70">{onlineCount}/{live.members.length}</span>
      </div>
      <div className="flex-1 min-h-0">
        {liveStatus !== 'ready' && !live.members.length ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Cargando miembros…</div>
        ) : !rows.length ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Sin miembros.</div>
        ) : (
          <List<RowProps>
            rowCount={rows.length}
            rowHeight={rowHeight}
            rowComponent={Row}
            rowProps={{ rows, selectedPubkey: selected, onSelect: selectMember }}
            overscanCount={6}
            className="h-full"
          />
        )}
      </div>
    </aside>
  );
}
