import React, { useState, useEffect, useRef, useCallback } from "react";
import { SimplePool, Event, getEventHash, getSignature, nip04, nip19 } from "nostr-tools";
import { relayUrls } from "../config";
import LinkPreview from './LinkPreview';
import TypingIndicator from './TypingIndicator';
import StarredMessages, { loadStarredFromStorage, saveStarredToStorage, type StarredMessage as StarredMsg } from './StarredMessages';
import MessageSearch from './MessageSearch';

interface ChannelInfo {
  id: string;
  name: string;
}

interface ChatProps {
  privateKey: string;
  publicKey: string;
  pool: SimplePool;
  selectedContact?: string | null;
  selectedChannelId?: string | null;
  channelName?: string;
  /** Vista "Todo": feed unificado (kind 1 + mensajes de canales). */
  unifiedFeed?: boolean;
  /** Canales para feed unificado y nombres. */
  channels?: ChannelInfo[];
  onNotify?: (title: string, body: string, data?: { messageId?: string; type?: string }) => void;
}

interface Message {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  isPrivate: boolean;
  recipient?: string;
  replyTo?: string;
  replyContent?: string;
  /** En feed unificado: canal del mensaje (kind 42). */
  channelId?: string;
  channelName?: string;
}

const TYPING_DEBOUNCE_MS = 800;
const TYPING_THROTTLE_MS = 2000;

type DmMentionResult =
  | { dmPubkey: string; content: string }
  | { mention: string; content: string };

/** Parsea @npub1xxx... o @username / @user@domain (NIP-05) al inicio para enviar DM. */
function parseDmMention(text: string): DmMentionResult | null {
  const trimmed = text.trim();
  // @npub1...
  const npubMatch = trimmed.match(/^@(npub1[a-zA-Z0-9]+)\s*(.*)$/s);
  if (npubMatch) {
    try {
      const decoded = nip19.decode(npubMatch[1]);
      if (decoded.type !== 'npub') return null;
      return { dmPubkey: decoded.data as string, content: (npubMatch[2] || '').trim() };
    } catch {
      return null;
    }
  }
  // @username o @user@domain.com (sin espacio en el identificador)
  const mentionMatch = trimmed.match(/^@([^\s]+)\s*(.*)$/s);
  if (mentionMatch) {
    const mention = mentionMatch[1].trim();
    const content = (mentionMatch[2] || '').trim();
    if (!mention) return null;
    return { mention, content };
  }
  return null;
}

/** Resuelve @mention a pubkey: caché de perfiles (name/display_name/nip05) o NIP-05. */
async function resolveMentionToPubkey(
  mention: string,
  profiles: Record<string, { name?: string; display_name?: string; nip05?: string }>
): Promise<string | null> {
  const mentionLower = mention.toLowerCase();
  for (const [pubkey, p] of Object.entries(profiles)) {
    if (p.nip05 && p.nip05.toLowerCase() === mentionLower) return pubkey;
    if (p.display_name && p.display_name.toLowerCase() === mentionLower) return pubkey;
    if (p.name && p.name.toLowerCase() === mentionLower) return pubkey;
  }
  if (mention.includes('@')) {
    try {
      const [local, domain] = mention.split('@').filter(Boolean);
      if (!local || !domain) return null;
      const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { names?: Record<string, string> };
      const hex = data.names?.[local];
      return hex ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

const MAX_NOTIFIED_IDS = 200;

const DRAFT_KEY = 'nostrdome_draft';
const DRAFT_DEBOUNCE_MS = 500;

function getDraftKey(selectedChannelId: string | null, selectedContact: string | null, unifiedFeed: boolean): string {
  if (unifiedFeed) return `${DRAFT_KEY}_unified`;
  if (selectedChannelId) return `${DRAFT_KEY}_channel_${selectedChannelId}`;
  if (selectedContact) return `${DRAFT_KEY}_dm_${selectedContact}`;
  return `${DRAFT_KEY}_global`;
}

const Chat: React.FC<ChatProps> = ({ privateKey, publicKey, pool, selectedContact, selectedChannelId, channelName, unifiedFeed = false, channels = [], onNotify }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelMessages, setChannelMessages] = useState<Message[]>([]);
  const [unifiedMessages, setUnifiedMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingPublishRef = useRef<number>(0);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDraftKeyRef = useRef<string>('');
  const [starredMessages, setStarredMessages] = useState<StarredMsg[]>(() => loadStarredFromStorage());
  const [showStarredPanel, setShowStarredPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profiles, setProfiles] = useState<Record<string, { name?: string; display_name?: string; nip05?: string }>>({});

  useEffect(() => {
    saveStarredToStorage(starredMessages);
  }, [starredMessages]);

  // NIP-05 / kind 0: cargar perfiles de autores para mostrar nombre en vez de pubkey
  useEffect(() => {
    const pubkeys = new Set<string>();
    pubkeys.add(publicKey);
    [...messages, ...channelMessages, ...unifiedMessages].forEach((m) => pubkeys.add(m.pubkey));
    const list = Array.from(pubkeys).slice(0, 150);
    if (list.length === 0) return;
    const sub = pool.sub(relayUrls, [{ kinds: [0], authors: list }]);
    sub.on('event', (event: Event) => {
      try {
        const d = JSON.parse(event.content || '{}');
        setProfiles((prev) => ({
          ...prev,
          [event.pubkey]: { name: d.name, display_name: d.display_name, nip05: d.nip05 },
        }));
      } catch {}
    });
    return () => sub.unsub();
  }, [pool, publicKey, messages, channelMessages, unifiedMessages]);

  const publishTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingPublishRef.current < TYPING_THROTTLE_MS) return;
    lastTypingPublishRef.current = now;
    const ev: Event = {
      kind: 20,
      pubkey: publicKey,
      created_at: Math.floor(now / 1000),
      tags: [],
      content: 'typing',
      id: '',
      sig: '',
    };
    ev.id = getEventHash(ev);
    ev.sig = getSignature(ev, privateKey);
    Promise.all(pool.publish(relayUrls, ev)).catch(() => {});
  }, [pool, publicKey, privateKey]);

  const scheduleTyping = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
      publishTyping();
    }, TYPING_DEBOUNCE_MS);
  }, [publishTyping]);

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{ kinds: [1, 4], limit: 100 }]);

    sub.on("event", async (event: Event) => {
      try {
        let messageContent = event.content;
        let isPrivateMessage = event.kind === 4;

        if (isPrivateMessage && event.tags.some((tag) => tag[0] === "p")) {
          const recipientPubkey = event.tags.find((tag) => tag[0] === "p")?.[1];
          if (recipientPubkey === publicKey || event.pubkey === publicKey) {
            try {
              messageContent = await nip04.decrypt(privateKey, event.pubkey, event.content);
            } catch (error) {
              console.error("Error decrypting message:", error);
              return;
            }
          } else {
            return;
          }
        }

        const newMessage: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: messageContent,
          created_at: event.created_at,
          isPrivate: isPrivateMessage,
          recipient: event.tags.find((tag) => tag[0] === "p")?.[1],
        };

        const isForUs =
          !isPrivateMessage || newMessage.pubkey === publicKey || newMessage.recipient === publicKey;
        if (isForUs) {
          const isFromOther = newMessage.pubkey !== publicKey;
          const isNew = !notifiedIdsRef.current.has(newMessage.id);
          // Solo notificar por mensajes privados (kind 4), nunca por el feed público (kind 1)
          const isDm = event.kind === 4;
          if (isFromOther && isNew && onNotify && isDm) {
            notifiedIdsRef.current.add(newMessage.id);
            if (notifiedIdsRef.current.size > MAX_NOTIFIED_IDS) {
              const arr = Array.from(notifiedIdsRef.current);
              notifiedIdsRef.current = new Set(arr.slice(-MAX_NOTIFIED_IDS / 2));
            }
            const preview = newMessage.content.slice(0, 80) + (newMessage.content.length > 80 ? '…' : '');
            onNotify('Mensaje privado', preview, { messageId: newMessage.id, type: 'dm' });
          }
          setMessages((prevMessages) => {
            if (!prevMessages.find((msg) => msg.id === newMessage.id)) {
              return [...prevMessages, newMessage].sort((a, b) => a.created_at - b.created_at);
            }
            return prevMessages;
          });
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    return () => {
      sub.unsub();
    };
  }, [pool, publicKey, privateKey]);

  // Suscripción a mensajes del canal (NIP-28 kind 42)
  useEffect(() => {
    if (!selectedChannelId) {
      setChannelMessages([]);
      return;
    }
    const sub = pool.sub(relayUrls, [
      { kinds: [42], '#e': [selectedChannelId], limit: 100 },
    ]);
    sub.on('event', (event: Event) => {
      const channelTag = event.tags.find((t) => t[0] === 'e' && t[1] === selectedChannelId);
      if (!channelTag) return;
      const newMsg: Message = {
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        created_at: event.created_at,
        isPrivate: false,
      };
      setChannelMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg].sort((a, b) => a.created_at - b.created_at);
      });
    });
    return () => {
      sub.unsub();
    };
  }, [pool, selectedChannelId]);

  // Feed unificado: kind 1 + kind 42 de varios canales
  useEffect(() => {
    if (!unifiedFeed || channels.length === 0) {
      setUnifiedMessages([]);
      return;
    }
    const channelIds = channels.slice(0, 25).map((c) => c.id);
    const byId: Record<string, { id: string; name: string }> = {};
    channels.forEach((c) => { byId[c.id] = { id: c.id, name: c.name }; });

    const sub = pool.sub(relayUrls, [
      { kinds: [1], limit: 50 },
      { kinds: [42], '#e': channelIds, limit: 100 },
    ]);
    sub.on('event', (event: Event) => {
      if (event.kind === 1) {
        const newMsg: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          isPrivate: false,
        };
        setUnifiedMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg].sort((a, b) => a.created_at - b.created_at);
        });
        return;
      }
      if (event.kind === 42) {
        const rootTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'root');
        const channelId = rootTag?.[1];
        if (!channelId || !byId[channelId]) return;
        const newMsg: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          isPrivate: false,
          channelId,
          channelName: byId[channelId].name,
        };
        setUnifiedMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg].sort((a, b) => a.created_at - b.created_at);
        });
      }
    });
    return () => sub.unsub();
  }, [pool, unifiedFeed, channels]);

  // Borrador por contexto: al cambiar contexto, guardar en clave anterior y cargar el nuevo
  useEffect(() => {
    const key = getDraftKey(selectedChannelId ?? null, selectedContact ?? null, unifiedFeed);
    if (prevDraftKeyRef.current && prevDraftKeyRef.current !== key && input.trim()) {
      try {
        localStorage.setItem(prevDraftKeyRef.current, input);
      } catch {}
    }
    prevDraftKeyRef.current = key;
    try {
      const saved = localStorage.getItem(key);
      if (saved != null) setInput(saved);
    } catch {}
  }, [selectedChannelId, selectedContact, unifiedFeed]);

  // Borrador: guardar con debounce al escribir
  useEffect(() => {
    if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);
    const key = getDraftKey(selectedChannelId ?? null, selectedContact ?? null, unifiedFeed);
    draftTimeoutRef.current = setTimeout(() => {
      draftTimeoutRef.current = null;
      try {
        if (input.trim()) localStorage.setItem(key, input);
        else localStorage.removeItem(key);
      } catch {}
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);
    };
  }, [input, selectedChannelId, selectedContact, unifiedFeed]);

  // Hilos: suscripción a respuestas del mensaje raíz
  useEffect(() => {
    if (!threadRoot || !selectedChannelId) {
      setThreadReplies([]);
      return;
    }
    const sub = pool.sub(relayUrls, [
      { kinds: [42], '#e': [threadRoot.id], limit: 50 },
    ]);
    sub.on('event', (event: Event) => {
      const replyTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'reply' && t[1] === threadRoot.id);
      if (!replyTag || event.id === threadRoot.id) return;
      const newMsg: Message = {
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        created_at: event.created_at,
        isPrivate: false,
      };
      setThreadReplies((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg].sort((a, b) => a.created_at - b.created_at);
      });
    });
    return () => sub.unsub();
  }, [pool, threadRoot, selectedChannelId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, channelMessages, unifiedMessages]);

  const sendMessage = async () => {
    const rawInput = input.trim();
    if (!rawInput) return;

    // Mensaje en canal (NIP-28 kind 42)
    if (selectedChannelId) {
      try {
        const tags: string[][] = [['e', selectedChannelId, '', 'root']];
        if (replyingTo) {
          tags.push(['e', replyingTo.id, '', 'reply']);
          tags.push(['p', replyingTo.pubkey, '']);
        }
        const event: Event<number> = {
          id: '',
          sig: '',
          kind: 42,
          pubkey: publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: rawInput,
        };
        event.id = getEventHash(event);
        event.sig = getSignature(event, privateKey);
        await pool.publish(relayUrls, event);
        const newMessage: Message = {
          id: event.id,
          pubkey: publicKey,
          content: rawInput,
          created_at: event.created_at,
          isPrivate: false,
        };
        setChannelMessages((prev) =>
          [...prev, newMessage].sort((a, b) => a.created_at - b.created_at)
        );
        setInput('');
        setReplyingTo(null);
        setEditingMessage(null);
      } catch (error) {
        console.error('Error sending channel message:', error);
      }
      return;
    }

    // DM por mención @npub, @username o @user@domain (NIP-05)
    let recipientPubkey = selectedContact || replyingTo?.pubkey || '';
    let contentToSend = rawInput;
    if (!selectedContact && !replyingTo) {
      const dmFromMention = parseDmMention(rawInput);
      if (dmFromMention) {
        if ('dmPubkey' in dmFromMention) {
          recipientPubkey = dmFromMention.dmPubkey;
          contentToSend = dmFromMention.content;
        } else {
          const resolved = await resolveMentionToPubkey(dmFromMention.mention, profiles);
          if (resolved) {
            recipientPubkey = resolved;
            contentToSend = dmFromMention.content;
          } else {
            onNotify?.('Usuario no encontrado', `No se pudo resolver @${dmFromMention.mention}`);
            return;
          }
        }
      }
    }
    const isDM = !!recipientPubkey;
    if (isDM && !contentToSend && !replyingTo) return;

    try {
      const event: Event<number> = {
        id: '',
        sig: '',
        kind: isDM ? 4 : 1,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: replyingTo
          ? [['e', replyingTo.id], ['p', recipientPubkey]]
          : isDM
            ? [['p', recipientPubkey]]
            : [],
        content: contentToSend,
      };

      if (event.kind === 4 && recipientPubkey) {
        try {
          event.content = await nip04.encrypt(privateKey, recipientPubkey, contentToSend);
        } catch (error) {
          console.error("Error encrypting message:", error);
          return;
        }
      }

      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);

      await pool.publish(relayUrls, event);

      const newMessage: Message = {
        id: event.id,
        pubkey: publicKey,
        content: contentToSend,
        created_at: event.created_at,
        isPrivate: event.kind === 4,
        recipient: recipientPubkey || replyingTo?.pubkey,
      };

      setMessages((prevMessages) => 
        [...prevMessages, newMessage].sort((a, b) => a.created_at - b.created_at)
      );

      setInput("");
      setReplyingTo(null);
      setEditingMessage(null);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleEditMessage = (msg: Message) => {
    setInput(msg.content);
    setEditingMessage(msg);
    setReplyingTo(null);
  };

  const handleReply = (msg: Message) => {
    setInput(msg.content);
    setReplyingTo(msg);
    setEditingMessage(null);
  };

  const isStarred = (id: string) => starredMessages.some((m) => m.id === id);
  const toggleStarred = (msg: Message) => {
    if (isStarred(msg.id)) {
      setStarredMessages((prev) => prev.filter((m) => m.id !== msg.id));
    } else {
      setStarredMessages((prev) => [
        ...prev,
        { id: msg.id, content: msg.content, pubkey: msg.pubkey, created_at: msg.created_at },
      ]);
    }
  };

  const formatPubkey = (pubkey: string, short: boolean = false): string => {
    try {
      const npub = pubkey.startsWith('npub') ? pubkey : nip19.npubEncode(pubkey);
      return short ? `${npub.slice(0, 7)}` : npub;
    } catch (error) {
      console.error('Error formatting pubkey:', error);
      return pubkey;
    }
  };

  /** Muestra NIP-05, display_name o name (kind 0) si existe; si no, npub corto. */
  const formatDisplayName = (pubkey: string): string => {
    const p = profiles[pubkey];
    if (p?.nip05) return p.nip05;
    if (p?.display_name) return p.display_name;
    if (p?.name) return p.name;
    return formatPubkey(pubkey, true);
  };

  const isImageUrl = (url: string): boolean => {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  };

  const extractUrls = (text: string): string[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  };

  const renderMessageContent = (content: string) => {
    const urls = extractUrls(content);
    if (urls.length === 0) {
      return <span>{content}</span>;
    }

    let lastIndex = 0;
    const elements: JSX.Element[] = [];

    urls.forEach((url, index) => {
      const startIndex = content.indexOf(url, lastIndex);
      
      if (startIndex > lastIndex) {
        elements.push(
          <span key={`text-${index}`}>
            {content.slice(lastIndex, startIndex)}
          </span>
        );
      }

      if (isImageUrl(url)) {
        elements.push(
          <div key={`image-${index}`} className="mt-2 max-w-sm">
            <img
              src={url}
              alt="Shared content"
              className="rounded-lg max-h-64 object-cover cursor-pointer hover:opacity-90"
              onClick={() => window.open(url, '_blank')}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        );
      } else {
        elements.push(
          <LinkPreview key={`link-${index}`} url={url} />
        );
      }

      lastIndex = startIndex + url.length;
    });

    if (lastIndex < content.length) {
      elements.push(
        <span key="text-final">
          {content.slice(lastIndex)}
        </span>
      );
    }

    return <div>{elements}</div>;
  };

  const displayMessages = unifiedFeed
    ? unifiedMessages.filter(
        (msg) =>
          !searchQuery.trim() ||
          msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          msg.pubkey.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (msg.channelName && msg.channelName.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : selectedChannelId
      ? channelMessages.filter(
          (msg) =>
            !searchQuery.trim() ||
            msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
            msg.pubkey.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : (selectedContact
          ? messages.filter(
              (msg) =>
                msg.isPrivate &&
                (msg.pubkey === selectedContact || msg.recipient === selectedContact)
            )
          : messages
        ).filter(
          (msg) =>
            !searchQuery.trim() ||
            msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
            msg.pubkey.toLowerCase().includes(searchQuery.toLowerCase())
        );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)] flex-wrap gap-2 bg-[var(--chat-bg)]">
        {unifiedFeed && (
          <span className="text-[15px] font-semibold text-[var(--text-color)]">📋 Todo</span>
        )}
        {!unifiedFeed && selectedChannelId && channelName && (
          <span className="text-[15px] font-semibold text-[var(--text-color)]"># {channelName}</span>
        )}
        <button
          type="button"
          onClick={() => setShowStarredPanel((v) => !v)}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-color)] flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--sidebar-hover)]"
        >
          ⭐ Destacados {starredMessages.length > 0 && `(${starredMessages.length})`}
        </button>
        <MessageSearch onSearch={setSearchQuery} />
      </div>
      {showStarredPanel && (
        <div className="p-4 border-b border-[var(--border-subtle)] max-h-48 overflow-y-auto bg-[var(--sidebar-bg)]">
          <StarredMessages
            messages={starredMessages}
            onMessagesChange={(list) => {
              setStarredMessages(list);
              saveStarredToStorage(list);
            }}
          />
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div className={`flex-grow overflow-y-auto space-y-1 px-4 py-3 chat-bg ${threadRoot ? 'mr-80 shrink-0' : ''}`}>
        {displayMessages.map((msg) => (
          <div
            key={msg.id}
            id={msg.id}
            className={`message ${msg.pubkey === publicKey ? 'user self-end' : 'self-start'}`}
          >
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="font-semibold text-[13px]" style={{ color: 'var(--primary-color)' }} title={formatPubkey(msg.pubkey, false)}>{formatDisplayName(msg.pubkey)}</span>
              {msg.channelName && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--sidebar-hover)] text-[var(--text-muted)]"># {msg.channelName}</span>
              )}
              {msg.isPrivate && (
                <span className="text-xs opacity-75">[Privado]</span>
              )}
            </div>
            <div className="break-words text-[15px] leading-snug">
              {renderMessageContent(msg.content)}
            </div>
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              <button
                type="button"
                onClick={() => handleReply(msg)}
                className="text-xs px-2 py-1 rounded opacity-80 hover:opacity-100 hover:bg-[var(--sidebar-hover)] transition-colors"
              >
                Responder
              </button>
              {selectedChannelId && !threadRoot && (
                <button
                  type="button"
                  onClick={() => setThreadRoot(msg)}
                  className="text-xs px-2 py-1 rounded opacity-80 hover:opacity-100 hover:bg-[var(--sidebar-hover)] transition-colors"
                >
                  Ver hilo
                </button>
              )}
              {msg.pubkey === publicKey && !selectedChannelId && (
                <button
                  type="button"
                  onClick={() => handleEditMessage(msg)}
                  className="text-xs px-2 py-1 rounded opacity-80 hover:opacity-100 hover:bg-[var(--sidebar-hover)] transition-colors"
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleStarred(msg)}
                className={`text-xs px-2 py-1 rounded transition-colors ${isStarred(msg.id) ? 'opacity-100' : 'opacity-60 hover:opacity-100 hover:bg-[var(--sidebar-hover)]'}`}
                title={isStarred(msg.id) ? 'Quitar de destacados' : 'Destacar'}
              >
                ⭐
              </button>
              <MessageReactions 
                messageId={msg.id}
                pool={pool}
                publicKey={publicKey}
                privateKey={privateKey}
              />
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
        </div>
        {threadRoot && selectedChannelId && (
          <div className="w-80 shrink-0 border-l border-[var(--border-subtle)] flex flex-col bg-[var(--sidebar-bg)] overflow-hidden">
            <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-color)]">Hilo</span>
              <button
                type="button"
                onClick={() => { setThreadRoot(null); setThreadReplies([]); }}
                className="p-1 rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-muted)]"
                aria-label="Cerrar hilo"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
              <div className={`message ${threadRoot.pubkey === publicKey ? 'user self-end' : 'self-start'}`}>
                <div className="font-semibold text-[13px]" style={{ color: 'var(--primary-color)' }} title={formatPubkey(threadRoot.pubkey, false)}>{formatDisplayName(threadRoot.pubkey)}</div>
                <div className="break-words text-[14px]">{renderMessageContent(threadRoot.content)}</div>
              </div>
              {threadReplies.map((msg) => (
                <div key={msg.id} className={`message ${msg.pubkey === publicKey ? 'user self-end' : 'self-start'}`}>
                  <div className="font-semibold text-[13px]" style={{ color: 'var(--primary-color)' }} title={formatPubkey(msg.pubkey, false)}>{formatDisplayName(msg.pubkey)}</div>
                  <div className="break-words text-[14px]">{renderMessageContent(msg.content)}</div>
                  <button type="button" onClick={() => handleReply(msg)} className="text-xs mt-1 opacity-80 hover:opacity-100">Responder</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 input-bar-bg px-4 py-3 border-t border-[var(--border-subtle)]">
        <TypingIndicator pool={pool} publicKey={publicKey} />
        {replyingTo && (
          <div className="mb-2 py-2 px-3 rounded text-sm flex justify-between items-center bg-[var(--input-bg)] text-[var(--text-muted)]">
            <div className="min-w-0">
              <span className="text-xs">Respondiendo a {formatDisplayName(replyingTo.pubkey)}</span>
              <div className="truncate text-[13px]">{replyingTo.content}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="shrink-0 ml-2 p-1 rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-color)]"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim()) scheduleTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            className="flex-grow min-w-0 rounded-lg py-2.5 px-4 text-[15px]"
            placeholder={
              replyingTo
                ? replyingTo.isPrivate
                  ? "Responder en privado..."
                  : "Responder..."
                : editingMessage
                  ? "Editando mensaje..."
                  : unifiedFeed
                    ? "Publicar en el feed..."
                    : selectedChannelId
                      ? `Mensaje en #${channelName || 'canal'}...`
                      : selectedContact
                        ? "Mensaje privado..."
                        : "Escribe aquí o @usuario / @npub para DM..."
            }
          />
          <button
            type="button"
            onClick={sendMessage}
            className="btn-primary shrink-0 px-5 py-2.5 rounded-lg font-medium"
          >
            {editingMessage ? "Actualizar" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ReactionProps {
  messageId: string;
  pool: SimplePool;
  publicKey: string;
  privateKey: string;
}

const MessageReactions: React.FC<ReactionProps> = ({ messageId, pool, publicKey, privateKey }) => {
  const [reactions, setReactions] = useState<Record<string, Set<string>>>({
    '👍': new Set(),
    '❤️': new Set(),
    '😂': new Set(),
    '🔥': new Set(),
  });

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{
      kinds: [7],
      '#e': [messageId]
    }]);

    sub.on('event', (event: Event) => {
      const emoji = event.content;
      if (reactions[emoji]) {
        setReactions(prev => ({
          ...prev,
          [emoji]: new Set([...prev[emoji], event.pubkey])
        }));
      }
    });

    return () => {
      sub.unsub();
    };
  }, [messageId, pool]);

  const sendReaction = async (emoji: string) => {
    const event: Event = {
      kind: 7,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', messageId]],
      content: emoji,
      id: '',
      sig: ''
    };

    event.id = getEventHash(event);
    event.sig = getSignature(event, privateKey);

    await pool.publish(relayUrls, event);
  };

  return (
    <div className="flex gap-1">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => sendReaction(emoji)}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            users.has(publicKey)
              ? 'bg-[var(--primary-color)] text-white'
              : 'bg-[var(--sidebar-active)] text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]'
          }`}
        >
          {emoji} {users.size > 0 && users.size}
        </button>
      ))}
    </div>
  );
};

export default Chat;