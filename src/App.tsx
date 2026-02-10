import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool, getPublicKey, generatePrivateKey, nip19, Event } from 'nostr-tools';
import Chat from './components/Chat';
import Login from './components/Login';
import RelayStatus from './components/RelayStatus';
import ThemeSelector from './components/ThemeSelector';
import Notifications, { type ShowNotificationFn } from './components/Notifications';
import ContactList from './components/ContactList';
import ChannelList from './components/ChannelList';
import { relayUrls } from './config';

export interface Contact {
  pubkey: string;
  name?: string;
  about?: string;
}

export interface Channel {
  id: string;
  name: string;
  about?: string;
  picture?: string;
  pubkey: string;
  created_at: number;
}

export type Theme = 'matrix' | 'cyberpunk' | 'midnight' | 'light';

function App() {
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [pool, setPool] = useState<SimplePool | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('nostrdome_theme') as Theme) || 'matrix');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const showNotificationRef = useRef<ShowNotificationFn | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNotify = useCallback((title: string, body: string, data?: { messageId?: string; type?: string }) => {
    showNotificationRef.current?.(title, body, data);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ title, body });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const loadContacts = useCallback((pool: SimplePool, pubkey: string) => {
    const sub = pool.sub(relayUrls, [{ kinds: [3], authors: [pubkey], limit: 1 }]);
    sub.on('event', (event: Event) => {
      const pubkeys = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
      const petnames: Record<string, string> = {};
      event.tags.forEach((t) => {
        if (t[0] === 'p' && t[3]) petnames[t[1]] = t[3]; // NIP-02: ["p", pubkey, relay?, petname?]
      });
      if (pubkeys.length === 0) {
        setContacts([]);
        return;
      }
      const sub0 = pool.sub(relayUrls, [{ kinds: [0], authors: pubkeys }]);
      const meta: Record<string, { name?: string; about?: string }> = {};
      sub0.on('event', (e: Event) => {
        try {
          const d = JSON.parse(e.content || '{}');
          meta[e.pubkey] = { name: d.name, about: d.about };
        } catch {}
      });
      sub0.on('eose', () => {
        sub0.unsub();
        setContacts(
          pubkeys.map((p) => ({
            pubkey: p,
            name: meta[p]?.name || petnames[p] || nip19.npubEncode(p).slice(0, 12) + '…',
            about: meta[p]?.about,
          }))
        );
      });
    });
    sub.on('eose', () => sub.unsub());
  }, []);

  const loadChannels = useCallback((pool: SimplePool) => {
    const sub = pool.sub(relayUrls, [{ kinds: [40], limit: 50 }]);
    const byId: Record<string, Channel> = {};
    sub.on('event', (event: Event) => {
      try {
        const meta = JSON.parse(event.content || '{}');
        byId[event.id] = {
          id: event.id,
          name: meta.name || 'Sin nombre',
          about: meta.about,
          picture: meta.picture,
          pubkey: event.pubkey,
          created_at: event.created_at,
        };
      } catch {
        byId[event.id] = {
          id: event.id,
          name: 'Sin nombre',
          pubkey: event.pubkey,
          created_at: event.created_at,
        };
      }
    });
    sub.on('eose', () => {
      sub.unsub();
      setChannels(Object.values(byId).sort((a, b) => b.created_at - a.created_at));
    });
  }, []);

  useEffect(() => {
    const storedPrivateKey = localStorage.getItem('nostrPrivateKey');
    if (storedPrivateKey) {
      setPrivateKey(storedPrivateKey);
      setPublicKey(getPublicKey(storedPrivateKey));
    }

    const newPool = new SimplePool();
    setPool(newPool);

    return () => {
      newPool.close(relayUrls);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nostrdome_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (pool && publicKey) loadContacts(pool, publicKey);
  }, [pool, publicKey, loadContacts]);

  useEffect(() => {
    if (pool) loadChannels(pool);
  }, [pool, loadChannels]);

  const handleLogin = (inputPrivateKey: string) => {
    if (inputPrivateKey) {
      setPrivateKey(inputPrivateKey);
      const derivedPublicKey = getPublicKey(inputPrivateKey);
      setPublicKey(derivedPublicKey);
      localStorage.setItem('nostrPrivateKey', inputPrivateKey);
    } else {
      const newPrivateKey = generatePrivateKey();
      setPrivateKey(newPrivateKey);
      const newPublicKey = getPublicKey(newPrivateKey);
      setPublicKey(newPublicKey);
      localStorage.setItem('nostrPrivateKey', newPrivateKey);
    }
  };

  const handleLogout = () => {
    setPrivateKey(null);
    setPublicKey(null);
    localStorage.removeItem('nostrPrivateKey');
  };

  return (
    <div className="h-screen app-theme font-mono flex flex-col overflow-hidden">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-30 max-w-md w-full mx-4 px-4 py-3 rounded-lg shadow-lg border flex items-start gap-3"
          style={{
            backgroundColor: 'var(--header-bg)',
            borderColor: 'var(--primary-color)',
            color: 'var(--text-color)',
          }}
          role="alert"
        >
          <span className="shrink-0 text-lg">🔔</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{toast.title}</div>
            <div className="text-sm opacity-90 truncate" title={toast.body}>{toast.body}</div>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 opacity-70 hover:opacity-100 p-1"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      )}
      <header className="shrink-0 header-theme p-4 z-10 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">Nostrdome</h1>
        {publicKey && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm truncate max-w-[180px] sm:max-w-none" title={nip19.npubEncode(publicKey)}>
                {nip19.npubEncode(publicKey).slice(0, 12)}…
              </p>
              <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
              <Notifications
                onNotificationChange={() => {}}
                onRegisterShow={(show) => { showNotificationRef.current = show; }}
                publicKey={publicKey}
              />
              <button
                onClick={handleLogout}
                className="btn-logout px-2 py-1 rounded"
              >
                Logout
              </button>
            </div>
        )}
      </header>
      <main className="flex-1 min-h-0 flex p-4 pt-4 overflow-hidden">
        {privateKey && publicKey && pool ? (
          <>
            <div className="w-56 shrink-0 border-r border-gray-700 flex flex-col min-h-0 overflow-hidden">
              <ChannelList
                channels={channels}
                selectedChannelId={selectedChannelId}
                onSelectChannel={(id) => {
                  setSelectedChannelId(id);
                  if (id) setSelectedContact(null);
                }}
                pool={pool}
                privateKey={privateKey}
                publicKey={publicKey}
                onChannelCreated={() => pool && loadChannels(pool)}
              />
              <ContactList
                contacts={contacts}
                selectedContact={selectedContact}
                onSelectContact={(pubkey) => {
                  setSelectedContact((prev) => (prev === pubkey ? null : pubkey));
                  setSelectedChannelId(null);
                }}
              />
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              <Chat
                privateKey={privateKey}
                publicKey={publicKey}
                pool={pool}
                selectedContact={selectedContact}
                selectedChannelId={selectedChannelId}
                channelName={selectedChannelId ? channels.find((c) => c.id === selectedChannelId)?.name : undefined}
                onNotify={handleNotify}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <Login onLogin={handleLogin} />
          </div>
        )}
      </main>
      {pool && publicKey && (
        <div className="fixed bottom-4 right-4 z-20">
          <RelayStatus pool={pool} />
        </div>
      )}
    </div>
  );
}

export default App;