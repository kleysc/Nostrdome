import React, { useState, useEffect, useRef, useCallback } from "react";
import { SimplePool, Event, getEventHash, getSignature, nip04, nip19 } from "nostr-tools";
import { relayUrls } from "../config";
import LinkPreview from './LinkPreview';
import TypingIndicator from './TypingIndicator';
import StarredMessages, { loadStarredFromStorage, saveStarredToStorage, type StarredMessage as StarredMsg } from './StarredMessages';
import MessageSearch from './MessageSearch';

interface ChatProps {
  privateKey: string;
  publicKey: string;
  pool: SimplePool;
  selectedContact?: string | null;
  /** Canal NIP-28 seleccionado (kind 40 event id). Si está definido, se muestran y envían mensajes kind 42. */
  selectedChannelId?: string | null;
  /** Nombre del canal (para mostrar en la UI). */
  channelName?: string;
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
}

const TYPING_DEBOUNCE_MS = 800;
const TYPING_THROTTLE_MS = 2000;

/** Parsea @npub1xxx... al inicio del mensaje para enviar DM. Devuelve { dmPubkey, content } o null. */
function parseDmMention(text: string): { dmPubkey: string; content: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^@(npub1[a-zA-Z0-9]+)\s*(.*)$/s);
  if (!match) return null;
  try {
    const decoded = nip19.decode(match[1]);
    if (decoded.type !== 'npub') return null;
    const content = (match[2] || '').trim();
    return { dmPubkey: decoded.data as string, content };
  } catch {
    return null;
  }
}

const MAX_NOTIFIED_IDS = 200;

const Chat: React.FC<ChatProps> = ({ privateKey, publicKey, pool, selectedContact, selectedChannelId, channelName, onNotify }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [channelMessages, setChannelMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingPublishRef = useRef<number>(0);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const [starredMessages, setStarredMessages] = useState<StarredMsg[]>(() => loadStarredFromStorage());
  const [showStarredPanel, setShowStarredPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    saveStarredToStorage(starredMessages);
  }, [starredMessages]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, channelMessages]);

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

    // DM por mención @npub1... (tiene prioridad si no hay contacto seleccionado ni respuesta)
    const dmFromMention = !selectedContact && !replyingTo ? parseDmMention(rawInput) : null;
    const dmRecipient = selectedContact || replyingTo?.pubkey || dmFromMention?.dmPubkey;
    const isDM = !!dmRecipient;
    const recipientPubkey = dmRecipient || (replyingTo ? replyingTo.pubkey : '');
    const contentToSend = dmFromMention ? dmFromMention.content : rawInput;
    if (isDM && !contentToSend && !replyingTo) return; // mensaje vacío solo con @npub

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

  const displayMessages = selectedChannelId
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 flex-wrap gap-2">
        {selectedChannelId && channelName && (
          <span className="text-sm font-semibold opacity-90"># {channelName}</span>
        )}
        <button
          type="button"
          onClick={() => setShowStarredPanel((v) => !v)}
          className="text-sm opacity-80 hover:opacity-100 flex items-center gap-1"
        >
          ⭐ Destacados {starredMessages.length > 0 && `(${starredMessages.length})`}
        </button>
        <MessageSearch onSearch={setSearchQuery} />
      </div>
      {showStarredPanel && (
        <div className="p-4 border-b border-gray-700 max-h-48 overflow-y-auto">
          <StarredMessages
            messages={starredMessages}
            onMessagesChange={(list) => {
              setStarredMessages(list);
              saveStarredToStorage(list);
            }}
          />
        </div>
      )}
      <div className="flex-grow overflow-y-auto mb-16 space-y-2 p-4">
        {displayMessages.map((msg) => (
          <div key={msg.id} id={msg.id}
            className={`message p-2 rounded-lg ${
              msg.pubkey === publicKey 
                ? "self-end bg-green-600 text-white" 
                : "self-start bg-gray-100"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold">{formatPubkey(msg.pubkey, true)}</span>
              {msg.isPrivate && (
                <span className="text-purple-300 text-sm">[Privado]</span>
              )}
            </div>
            <div className="break-words">
              {renderMessageContent(msg.content)}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button 
                onClick={() => handleReply(msg)} 
                className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
              >
                Responder
              </button>
              {msg.pubkey === publicKey && !selectedChannelId && (
                <button 
                  onClick={() => handleEditMessage(msg)} 
                  className="bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600"
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleStarred(msg)}
                className={`px-2 py-1 rounded text-sm ${isStarred(msg.id) ? 'bg-amber-500 text-black' : 'bg-gray-600 hover:bg-gray-500'}`}
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
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-2">
        <TypingIndicator pool={pool} publicKey={publicKey} />
        {replyingTo && (
          <div className="bg-gray-700 p-2 mb-2 rounded flex justify-between items-center">
            <div>
              <span className="text-sm text-gray-400">
                Respondiendo a {formatPubkey(replyingTo.pubkey, true)}
              </span>
              <div className="text-sm truncate">{replyingTo.content}</div>
            </div>
            <button 
              onClick={() => setReplyingTo(null)}
              className="text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim()) scheduleTyping();
            }}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                sendMessage();
              }
            }}
            className="flex-grow bg-gray-700 text-green-500 p-2 rounded-l focus:outline-none"
            placeholder={
              replyingTo
                ? replyingTo.isPrivate
                  ? "Responder en privado..."
                  : "Responder..."
                : editingMessage
                  ? "Editando mensaje..."
                  : selectedChannelId
                    ? `Mensaje en #${channelName || 'canal'}...`
                    : selectedContact
                      ? "Mensaje privado..."
                      : "Escribe aquí o @npub... para DM..."
            }
          />
          <button 
            onClick={sendMessage} 
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-500"
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
    <div className="flex gap-2">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => sendReaction(emoji)}
          className={`px-2 py-1 rounded text-sm ${
            users.has(publicKey) ? 'bg-green-600' : 'bg-gray-600 hover:bg-gray-500'
          }`}
        >
          {emoji} {users.size > 0 && users.size}
        </button>
      ))}
    </div>
  );
};

export default Chat;