import React, { useState, useEffect, useRef } from "react";
import { SimplePool, Event, getEventHash, getSignature, nip04, nip19 } from "nostr-tools";
import { relayUrls } from "../config";

interface ChatProps {
  privateKey: string;
  publicKey: string;
  pool: SimplePool;
}

interface Message {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  isPrivate: boolean;
  recipient?: string;
}

const Chat: React.FC<ChatProps> = ({ privateKey, publicKey, pool }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sub = pool.sub(relayUrls, [
      {
        kinds: [1, 4], 
        limit: 100,
      },
    ]);

    sub.on("event", async (event: Event) => {
      try {
        let messageContent = event.content;
        let isPrivateMessage = event.kind === 4;

        if (isPrivateMessage && event.tags.some((tag) => tag[0] === "p")) {
          const recipientPubkey = event.tags.find((tag) => tag[0] === "p")?.[1];
          if (recipientPubkey === publicKey || event.pubkey === publicKey) {
            try {
              messageContent = await nip04.decrypt(
                privateKey,
                event.pubkey,
                event.content
              );
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

        if (
          !isPrivateMessage ||
          newMessage.pubkey === publicKey ||
          newMessage.recipient === publicKey
        ) {
          setMessages((prevMessages) => {
            if (!prevMessages.find((msg) => msg.id === newMessage.id)) {
              return [...prevMessages, newMessage];
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    try {
      const event: Event<number> = {
        id: '',
        sig: '',
        kind: 1,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: input,
      };

      if (input.startsWith("@")) {
        const parts = input.split(" ");
        const mentionedPubkey = parts[0].slice(1);

        let decodedPubkey;
        try {
          const decoded = nip19.decode(mentionedPubkey);
          decodedPubkey = decoded.data as string;
        } catch (error) {
          console.error("Invalid public key format:", mentionedPubkey);
          return;
        }

        if (!decodedPubkey || decodedPubkey.length !== 64) {
          console.error("Invalid public key:", mentionedPubkey);
          return;
        }

        const messageContent = input.replace(`@${mentionedPubkey}`, "").trim();
        const encryptedContent = await nip04.encrypt(privateKey, decodedPubkey, messageContent);

        event.kind = 4;
        event.tags = [["p", decodedPubkey]];
        event.content = encryptedContent;
      }

      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);

      await pool.publish(relayUrls, event);
      setInput("");
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto mb-4 space-y-2 p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.pubkey === publicKey ? "self-end text-white" : "self-start text-white"} 
                       rounded-lg p-2 my-1 max-w-xs`}
            style={{
              alignSelf: msg.pubkey === publicKey ? 'flex-end' : 'flex-start',
              borderRadius: '10px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              marginLeft: msg.pubkey === publicKey ? 'auto' : '0',
              marginRight: msg.pubkey === publicKey ? '0' : 'auto',
              backgroundColor: msg.pubkey === publicKey ? '#1d4ed8' : '#4b5563',
            }}
          >
            <span className="font-bold">{msg.pubkey.slice(0, 8)}:</span>
            {msg.isPrivate && (
              <span className="ml-2 text-purple-300">[Private]</span>
            )}
            <span className="ml-2">{msg.content}</span>
            {msg.isPrivate && msg.pubkey !== publicKey && (
              <button
                onClick={() => setInput(`@${nip19.npubEncode(msg.pubkey)} `)}
                className="ml-2 text-blue-500 hover:underline"
              >
                Responder
              </button>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-2 flex">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          className="flex-grow bg-gray-700 text-green-500 p-2 rounded-l focus:outline-none"
          placeholder="Type @pubkey for private message..."
        />
        <button
          onClick={sendMessage}
          className="bg-green-700 text-white px-4 py-2 rounded-r hover:bg-green-600"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default Chat;
