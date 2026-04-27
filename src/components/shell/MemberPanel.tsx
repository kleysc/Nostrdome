// Side panel that opens when a member is clicked in MemberSidebar.
//
// Shows: avatar, display name (with per-server override badge), npub (copy
// to clipboard), joined date, "about", role chips with tooltips listing
// permissions. Action buttons are gated by the viewer's permissions in
// kind 39001 + the role permissions matrix.
//
// Mutations implemented inline here (kick) re-publish the full kind 39002
// state; the proper mod dashboard with bulk operations lives in F5 §5.1.
// We deliberately do NOT optimistically update the local store before the
// relay accepts — it'd hide auth/permission errors.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useAppStore, useGroupPresence, useLive } from '../../stores/store';
import { publishLive, type LiveRelay } from '../../lib/live-relay';
import {
  memberHasPermission,
  resolveMemberDisplay,
  resolveMemberPicture,
} from '../../stores/community-types';

interface MemberPanelProps {
  groupId: string;
  liveRelay: LiveRelay | null;
  privateKey: string;
  publicKey: string;
}

export default function MemberPanel({ groupId, liveRelay, privateKey, publicKey }: MemberPanelProps) {
  const navigate = useNavigate();
  const live = useLive(groupId);
  const profiles = useAppStore((s) => s.profiles);
  const presence = useGroupPresence(groupId);
  const selectedPubkey = useAppStore((s) => s.selectedMemberPubkey);
  const selectMember = useAppStore((s) => s.selectMember);
  const applyLiveMembers = useAppStore((s) => s.applyLiveMembers);

  const [busy, setBusy] = useState<null | 'kick'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!selectedPubkey) return null;
  const member = live.members.find((m) => m.pubkey === selectedPubkey);
  if (!member) return null;

  const profile = profiles[selectedPubkey];
  const npub = (() => {
    try { return nip19.npubEncode(selectedPubkey); } catch { return selectedPubkey; }
  })();
  const fallback = `${npub.slice(0, 14)}…`;
  const displayName = resolveMemberDisplay(member, profile, fallback);
  const picture = resolveMemberPicture(member, profile);
  const lastSeen = presence[selectedPubkey] ?? 0;
  const isOnline = Math.floor(Date.now() / 1000) - lastSeen < 90;

  const memberRoles = live.roles.filter((r) => member.roleIds.includes(r.id));

  const isOwner = live.metadata?.ownerPubkey === publicKey;
  const isSelf = selectedPubkey === publicKey;
  const isTargetOwner = live.metadata?.ownerPubkey === selectedPubkey;
  const canKick = !isSelf && !isTargetOwner && memberHasPermission(live, publicKey, 'kick');
  const canBan = !isSelf && !isTargetOwner && memberHasPermission(live, publicKey, 'ban');
  const canManageRoles = memberHasPermission(live, publicKey, 'manage_roles') || isOwner;

  function close() {
    selectMember(null);
    setError(null);
  }

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(npub);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  }

  function openDM() {
    navigate(`/dm/${selectedPubkey}`);
    close();
  }

  async function handleKick() {
    if (!liveRelay || !canKick || !member) return;
    setBusy('kick');
    setError(null);
    try {
      const remaining = live.members
        .filter((m) => m.pubkey !== member.pubkey)
        .map((m) => ({
          pubkey: m.pubkey,
          role_ids: m.roleIds,
          joined_at: m.joinedAt,
          display_override: m.displayOverride,
          picture_override: m.pictureOverride,
        }));
      // 1) Audit trail FIRST (kind 39250). The relay enforces §1.2.8:
      //    state mutations are rejected unless preceded by a recent audit
      //    event from the same actor for the same group.
      await publishLive(liveRelay, privateKey, {
        kind: 39250,
        content: JSON.stringify({
          action: 'kick',
          target: member.pubkey,
          reason: '',
        }),
        tags: [['h', groupId], ['action', 'kick'], ['target', member.pubkey]],
      });
      // 2) Re-publish full kind 39002 minus this member (last-write-wins).
      await publishLive(liveRelay, privateKey, {
        kind: 39002,
        content: JSON.stringify({ members: remaining }),
        tags: [['d', groupId]],
      });
      // 3) Reflect locally so the sidebar updates without waiting for echo.
      applyLiveMembers(groupId, remaining.map((m) => ({
        pubkey: m.pubkey,
        roleIds: m.role_ids,
        joinedAt: m.joined_at,
        displayOverride: m.display_override,
        pictureOverride: m.picture_override,
      })));
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 bg-black/40 flex justify-end"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="w-full max-w-sm h-full overflow-y-auto border-l border-[var(--border-subtle)] shadow-xl"
        style={{ backgroundColor: 'var(--header-bg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-4">
          <header className="flex items-start gap-3">
            <div className="relative shrink-0">
              {picture ? (
                <img src={picture} alt="" className="w-16 h-16 rounded-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold text-white"
                  style={{ backgroundColor: memberRoles[0]?.color ?? 'var(--border-subtle)' }} aria-hidden>
                  {displayName.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              <span
                className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
                style={{ backgroundColor: isOnline ? '#22c55e' : '#6b7280', borderColor: 'var(--header-bg)' }}
                aria-label={isOnline ? 'online' : 'offline'}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-[var(--text-color)] truncate">{displayName}</h2>
              {member.displayOverride && (
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">per-server nick</div>
              )}
              {profile?.nip05 && (
                <div className="text-xs text-[var(--text-muted)] truncate">{profile.nip05}</div>
              )}
              {isTargetOwner && (
                <div className="text-[10px] uppercase tracking-wide text-amber-400 mt-1">Owner</div>
              )}
            </div>
            <button type="button" onClick={close}
              className="text-[var(--text-muted)] hover:text-[var(--text-color)] text-lg leading-none px-2"
              aria-label="Cerrar">✕</button>
          </header>

          <section>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">npub</div>
            <button type="button" onClick={copyNpub}
              className="w-full text-left text-xs font-mono break-all rounded border border-[var(--border-subtle)] px-2 py-1.5 hover:border-[var(--primary-color)] text-[var(--text-color)]"
              title="Copiar al portapapeles">
              {copied ? '✓ Copiado' : npub}
            </button>
          </section>

          {profile?.about && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Acerca de</div>
              <p className="text-sm text-[var(--text-color)] whitespace-pre-wrap break-words">{profile.about}</p>
            </section>
          )}

          <section>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Roles</div>
            {memberRoles.length ? (
              <div className="flex flex-wrap gap-1.5">
                {memberRoles.map((r) => (
                  <span key={r.id}
                    title={r.permissions.length ? r.permissions.join(', ') : 'sin permisos'}
                    className="text-xs px-2 py-0.5 rounded-full border"
                    style={{ borderColor: r.color, color: r.color }}>
                    {r.badge ? `${r.badge} ` : ''}{r.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">Sin roles asignados.</p>
            )}
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Detalles</div>
            <dl className="text-xs text-[var(--text-muted)] grid grid-cols-2 gap-y-1">
              <dt>Joined</dt>
              <dd className="text-[var(--text-color)]">
                {member.joinedAt ? new Date(member.joinedAt * 1000).toLocaleDateString() : '—'}
              </dd>
              <dt>Estado</dt>
              <dd className="text-[var(--text-color)]">{isOnline ? 'Online' : 'Offline'}</dd>
            </dl>
          </section>

          <section className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <button type="button" onClick={openDM}
              className="w-full text-sm px-3 py-1.5 rounded border border-[var(--border-subtle)] hover:border-[var(--primary-color)] text-[var(--text-color)]">
              Enviar DM
            </button>
            {canManageRoles && (
              <button type="button" disabled
                className="w-full text-sm px-3 py-1.5 rounded border border-[var(--border-subtle)] opacity-50 text-[var(--text-color)]"
                title="Gestión de roles llega en F5">
                Editar roles (F5)
              </button>
            )}
            {canKick && (
              <button type="button" onClick={handleKick} disabled={busy === 'kick' || !liveRelay}
                className="w-full text-sm px-3 py-1.5 rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                {busy === 'kick' ? 'Expulsando…' : 'Expulsar miembro'}
              </button>
            )}
            {canBan && (
              <button type="button" disabled
                className="w-full text-sm px-3 py-1.5 rounded border border-red-500/50 text-red-400 opacity-50"
                title="Ban list (kind 39002 + ban registry) llega en F5">
                Banear (F5)
              </button>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
