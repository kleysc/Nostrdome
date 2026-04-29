// Chat panel for the NIP-29 community route. Renders messages from
// useChannelMessages (kind 39200), publishes via the same hook, recycles
// the existing LinkPreview / StarredMessages / MessageSearch primitives,
// and adds three F1-bound features:
//   • date dividers (Discord-style "Today" / "April 23 2026" headers),
//   • inline reply (no thread panel — that's F2 territory),
//   • per-pubkey local mute, applied before render.
//
// Drafts are kept in the chat slice keyed by (groupId, channelId) so a
// half-typed message survives channel switches and tab reloads.
//
// Errors from publish (auth-required, restricted, rate-limited) surface as
// a dismissable banner above the composer; the hook normalizes the OK
// reason into a user-facing string.
import { useEffect, useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { useAppStore, useLive } from '../../stores/store';
import {
  resolveMemberDisplay, resolveMemberPicture,
  type ChannelDef,
} from '../../stores/community-types';
import { useChannelMessages, type ChannelMessage } from '../../hooks/useChannelMessages';
import type { LiveRelay } from '../../lib/live-relay';
import LinkPreview from '../LinkPreview';
import MessageSearch from '../MessageSearch';
import StarredMessages, {
  loadStarredFromStorage, saveStarredToStorage, type StarredMessage as StarredMsg,
} from '../StarredMessages';
import LiveMessageReactions from './LiveMessageReactions';

interface LiveChatPanelProps {
  groupId: string;
  channel: ChannelDef;
  liveRelay: LiveRelay | null;
  privateKey: string;
  publicKey: string;
}

interface DividerRow { kind: 'divider'; key: string; label: string; }
interface MessageRow { kind: 'message'; key: string; message: ChannelMessage; }
type Row = DividerRow | MessageRow;

const URL_RE = /(https?:\/\/[^\s]+)/g;
const IMAGE_RE = /\.(jpe?g|png|gif|webp)(\?.*)?$/i;

function shortNpub(pubkey: string): string {
  try { return nip19.npubEncode(pubkey).slice(0, 12) + '…'; }
  catch { return pubkey.slice(0, 10) + '…'; }
}

function dateLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, yesterday)) return 'Ayer';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Build the flat list of rows (date dividers interleaved with messages),
// applying the mute + search filters first so dividers reflect what's
// actually visible.
function buildRows(
  messages: ChannelMessage[],
  mutedSet: Set<string>,
  search: string,
  matchPubkeyName: (pubkey: string) => string,
): Row[] {
  const q = search.trim().toLowerCase();
  const visible = messages.filter((m) => {
    if (mutedSet.has(m.pubkey)) return false;
    if (!q) return true;
    return (
      m.content.toLowerCase().includes(q)
      || m.pubkey.toLowerCase().includes(q)
      || matchPubkeyName(m.pubkey).toLowerCase().includes(q)
    );
  });
  const rows: Row[] = [];
  let lastLabel = '';
  for (const msg of visible) {
    const label = dateLabel(msg.createdAt);
    if (label !== lastLabel) {
      rows.push({ kind: 'divider', key: `d:${label}:${msg.id}`, label });
      lastLabel = label;
    }
    rows.push({ kind: 'message', key: `m:${msg.id}`, message: msg });
  }
  return rows;
}

function renderContentFragments(content: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of content.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > last) parts.push(<span key={`t-${key++}`}>{content.slice(last, start)}</span>);
    if (IMAGE_RE.test(url)) {
      parts.push(
        <div key={`i-${key++}`} className="mt-2 max-w-sm">
          <img
            src={url}
            alt=""
            className="rounded-lg max-h-64 object-cover cursor-pointer hover:opacity-90"
            onClick={() => window.open(url, '_blank')}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>,
      );
    } else {
      parts.push(<LinkPreview key={`l-${key++}`} url={url} />);
    }
    last = start + url.length;
  }
  if (last < content.length) parts.push(<span key={`t-${key++}`}>{content.slice(last)}</span>);
  return parts.length ? <>{parts}</> : <span>{content}</span>;
}

export default function LiveChatPanel({
  groupId, channel, liveRelay, privateKey, publicKey,
}: LiveChatPanelProps) {
  const { messages, status, error, send } = useChannelMessages({
    liveRelay,
    groupId,
    channelId: channel.id,
  });

  const profiles = useAppStore((s) => s.profiles);
  const live = useLive(groupId);
  const drafts = useAppStore((s) => s.drafts);
  const setDraft = useAppStore((s) => s.setDraft);
  const clearDraft = useAppStore((s) => s.clearDraft);
  const mutedPubkeys = useAppStore((s) => s.mutedPubkeys);
  const toggleMuted = useAppStore((s) => s.toggleMuted);

  const draftKey = `${groupId}::${channel.id}`;
  const [input, setInput] = useState<string>(drafts[draftKey] ?? '');
  const [replyingTo, setReplyingTo] = useState<ChannelMessage | null>(null);
  const [search, setSearch] = useState('');
  const [showStarred, setShowStarred] = useState(false);
  const [starred, setStarred] = useState<StarredMsg[]>(() => loadStarredFromStorage());
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rehydrate the input from the persisted draft on channel switch.
  useEffect(() => {
    setInput(drafts[draftKey] ?? '');
    setReplyingTo(null);
    setSendError(null);
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist starred — same convention as legacy Chat.tsx.
  useEffect(() => { saveStarredToStorage(starred); }, [starred]);

  // Echo the hook's error into the local banner (cleared on next send / dismiss).
  useEffect(() => { if (error) setSendError(error); }, [error]);

  // Auto-scroll to bottom when messages change. We keep the user at the
  // bottom unless they've scrolled up — for F1 this is good enough.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const mutedSet = useMemo(() => new Set(mutedPubkeys), [mutedPubkeys]);
  const memberDisplay = (pubkey: string): string => {
    const m = live.members.find((x) => x.pubkey === pubkey);
    const profile = profiles[pubkey];
    if (m) return resolveMemberDisplay(m, profile, shortNpub(pubkey));
    return profile?.display_name || profile?.name || shortNpub(pubkey);
  };
  const memberPicture = (pubkey: string): string | undefined => {
    const m = live.members.find((x) => x.pubkey === pubkey);
    const profile = profiles[pubkey];
    if (m) return resolveMemberPicture(m, profile);
    return profile?.picture;
  };

  const rows = useMemo(
    () => buildRows(messages, mutedSet, search, memberDisplay),
    // memberDisplay closes over `profiles`/`live` — listing them keeps the
    // memo honest. The wrapper itself is stable per render.
    [messages, mutedSet, search, profiles, live], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const updateDraft = (value: string) => {
    setInput(value);
    if (value) setDraft(groupId, channel.id, value);
    else clearDraft(groupId, channel.id);
  };

  const onSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !liveRelay) return;
    try {
      await send(
        { content: trimmed, reply: replyingTo ? { id: replyingTo.id, pubkey: replyingTo.pubkey } : undefined },
        privateKey,
      );
      setInput('');
      clearDraft(groupId, channel.id);
      setReplyingTo(null);
      setSendError(null);
    } catch {
      // Hook already set the friendly error; nothing to do here. Keep the
      // input + reply state intact so the user can retry.
    }
  };

  const isStarred = (id: string) => starred.some((m) => m.id === id);
  const toggleStar = (msg: ChannelMessage) => {
    setStarred((prev) =>
      isStarred(msg.id)
        ? prev.filter((m) => m.id !== msg.id)
        : [...prev, { id: msg.id, content: msg.content, pubkey: msg.pubkey, created_at: msg.createdAt }],
    );
  };

  return (
    <div className="chat-shell flex flex-col h-full min-h-0">
      <div className="chat-toolbar flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] flex-wrap gap-2">
        <div className="min-w-0">
          <span className="chat-context-pill text-[15px] font-semibold text-[var(--text-color)]">
            # {channel.name}
          </span>
          {channel.topic && (
            <span className="ml-2 text-xs text-[var(--text-muted)] truncate inline-block max-w-[400px] align-middle">
              — {channel.topic}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStarred((v) => !v)}
            className="chat-toolbar-btn text-sm text-[var(--text-muted)] hover:text-[var(--text-color)] flex items-center gap-1 px-2.5 py-1.5 rounded-lg"
          >
            Destacados {starred.length > 0 && `(${starred.length})`}
          </button>
          <MessageSearch onSearch={setSearch} />
        </div>
      </div>
      {showStarred && (
        <div className="chat-starred-panel p-4 border-b border-[var(--border-subtle)] max-h-52 overflow-y-auto">
          <StarredMessages messages={starred} onMessagesChange={setStarred} />
        </div>
      )}

      <div ref={scrollRef} className="chat-stream flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
        {status === 'loading' && messages.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] text-center py-4">Cargando mensajes…</div>
        )}
        {status === 'ready' && messages.length === 0 && (
          <div className="text-sm text-[var(--text-muted)] text-center py-8">
            Sin mensajes todavía. ¡Sé el primero en escribir!
          </div>
        )}
        {rows.map((row) => {
          if (row.kind === 'divider') {
            return (
              <div key={row.key} className="flex items-center gap-2 my-3 select-none">
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  {row.label}
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>
            );
          }
          const msg = row.message;
          const isSelf = msg.pubkey === publicKey;
          const replyTarget = msg.replyTo
            ? messages.find((m) => m.id === msg.replyTo)
            : undefined;
          const picture = memberPicture(msg.pubkey);
          const display = memberDisplay(msg.pubkey);
          return (
            <div
              key={row.key}
              id={msg.id}
              className={`message message-card ${isSelf ? 'user self-end' : 'self-start'}`}
            >
              {replyTarget && (
                <div className="text-xs text-[var(--text-muted)] mb-1 border-l-2 border-[var(--border-subtle)] pl-2 truncate">
                  ↩ {memberDisplay(replyTarget.pubkey)}: <span className="opacity-80">{replyTarget.content.slice(0, 80)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {picture ? (
                  <img src={picture} alt="" className="w-5 h-5 rounded-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-[var(--border-subtle)] flex items-center justify-center text-[10px] text-white">
                    {display.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="message-author font-semibold text-[13px]" title={msg.pubkey}>
                  {display}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {new Date(msg.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="message-body break-words text-[15px] leading-snug">
                {renderContentFragments(msg.content)}
              </div>
              <div className="message-actions mt-2 flex items-center gap-1 flex-wrap">
                <button type="button" onClick={() => setReplyingTo(msg)}
                  className="message-action-btn text-xs px-2.5 py-1 rounded-md transition-colors">
                  Responder
                </button>
                <button type="button" onClick={() => toggleStar(msg)}
                  className={`message-action-btn text-xs px-2.5 py-1 rounded-md transition-colors ${isStarred(msg.id) ? 'message-action-btn-active' : ''}`}
                  title={isStarred(msg.id) ? 'Quitar de destacados' : 'Destacar'}>
                  {isStarred(msg.id) ? '★' : '☆'}
                </button>
                {!isSelf && (
                  <button type="button" onClick={() => toggleMuted(msg.pubkey)}
                    className="message-action-btn text-xs px-2.5 py-1 rounded-md transition-colors"
                    title="Silenciar a este usuario localmente">
                    Silenciar
                  </button>
                )}
                {liveRelay && (
                  <LiveMessageReactions
                    liveRelay={liveRelay}
                    groupId={groupId}
                    channelId={channel.id}
                    messageId={msg.id}
                    messageAuthor={msg.pubkey}
                    privateKey={privateKey}
                    publicKey={publicKey}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sendError && (
        <div className="px-4 py-2 border-t border-red-500/40 bg-red-500/10 text-sm text-red-300 flex items-start gap-2">
          <span className="flex-1">{sendError}</span>
          <button type="button" onClick={() => setSendError(null)}
            className="shrink-0 text-red-200 hover:text-white" aria-label="Cerrar">
            ✕
          </button>
        </div>
      )}

      <div className="composer-shell shrink-0 px-4 py-3 border-t border-[var(--border-subtle)]">
        {replyingTo && (
          <div className="composer-reply mb-2 py-2 px-3 rounded-lg text-sm flex justify-between items-center text-[var(--text-muted)]">
            <div className="min-w-0">
              <span className="text-xs">Respondiendo a {memberDisplay(replyingTo.pubkey)}</span>
              <div className="truncate text-[13px]">{replyingTo.content}</div>
            </div>
            <button type="button" onClick={() => setReplyingTo(null)}
              className="shrink-0 ml-2 p-1.5 rounded-md hover:bg-[var(--sidebar-hover)] text-[var(--text-color)]"
              aria-label="Cancelar respuesta">
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder={liveRelay ? `Mensaje en #${channel.name}…` : 'Conectando al relay…'}
            disabled={!liveRelay}
            className="composer-input flex-grow min-w-0 rounded-xl py-2.5 px-4 text-[15px]"
          />
          <button type="button" onClick={() => void onSend()} disabled={!liveRelay || !input.trim()}
            className="composer-send shrink-0 px-5 py-2.5 rounded-xl font-medium disabled:opacity-50">
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
