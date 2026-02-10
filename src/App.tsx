import { useState, useEffect, useCallback, useRef } from 'react';
import { SimplePool, getPublicKey, generatePrivateKey, nip19, Event, getEventHash, getSignature } from 'nostr-tools';
import Chat from './components/Chat';
import Login from './components/Login';
import RelayStatus from './components/RelayStatus';
import ThemeSelector from './components/ThemeSelector';
import Notifications, { type ShowNotificationFn } from './components/Notifications';
import ContactList from './components/ContactList';
import ChannelList from './components/ChannelList';
import ProfileEditor, { type ProfileForm } from './components/ProfileEditor';
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
  const [unifiedFeed, setUnifiedFeed] = useState(false);
  const [myProfile, setMyProfile] = useState<{ name?: string; display_name?: string; nip05?: string; picture?: string } | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const pendingNicknameRef = useRef<string | null>(null);
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
      const meta: Record<string, { name?: string; display_name?: string; nip05?: string; about?: string }> = {};
      sub0.on('event', (e: Event) => {
        try {
          const d = JSON.parse(e.content || '{}');
          meta[e.pubkey] = { name: d.name, display_name: d.display_name, nip05: d.nip05, about: d.about };
        } catch {}
      });
      sub0.on('eose', () => {
        sub0.unsub();
        setContacts(
          pubkeys.map((p) => ({
            pubkey: p,
            name: meta[p]?.nip05 ?? meta[p]?.display_name ?? meta[p]?.name ?? petnames[p] ?? nip19.npubEncode(p).slice(0, 12) + '…',
            about: meta[p]?.about,
          }))
        );
      });
    });
    sub.on('eose', () => sub.unsub());
  }, []);

  const loadChannels = useCallback((pool: SimplePool) => {
    const sub = pool.sub(relayUrls, [{ kinds: [40], limit: 100 }]);
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

  // NIP-05 / kind 0: perfil del usuario para mostrar nombre en el header
  useEffect(() => {
    if (!pool || !publicKey) {
      setMyProfile(null);
      return;
    }
    const privateKey = localStorage.getItem('nostrPrivateKey');
    const pendingNick = pendingNicknameRef.current;
    if (privateKey && pendingNick) {
      pendingNicknameRef.current = null;
      const content = JSON.stringify({ name: pendingNick });
      const event: Event = {
        kind: 0,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content,
        id: '',
        sig: '',
      };
      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);
      Promise.all(pool.publish(relayUrls, event)).catch(() => {});
      setMyProfile((p) => ({ ...p, name: pendingNick }));
    }
    const sub = pool.sub(relayUrls, [{ kinds: [0], authors: [publicKey], limit: 1 }]);
    sub.on('event', (event: Event) => {
      try {
        const d = JSON.parse(event.content || '{}');
        setMyProfile({ name: d.name, display_name: d.display_name, nip05: d.nip05, picture: d.picture });
      } catch {
        setMyProfile(null);
      }
    });
    sub.on('eose', () => sub.unsub());
    return () => sub.unsub();
  }, [pool, publicKey]);

  const handleLogin = (inputPrivateKey: string, initialNickname?: string) => {
    if (initialNickname?.trim()) {
      pendingNicknameRef.current = initialNickname.trim();
    }
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
    <div className="h-screen app-theme flex flex-col overflow-hidden">
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
      <header className="shrink-0 header-theme px-4 py-2.5 z-10 flex flex-wrap items-center justify-between gap-3 shadow-sm border-b border-[var(--border-subtle)]">
        <h1 className="text-lg font-semibold tracking-tight text-[var(--text-color)]">Nostrdome</h1>
        {publicKey && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => pool && privateKey && setShowProfileEditor(true)}
                className="header-identity-pill max-w-[200px] sm:max-w-[240px] min-w-0"
                title={`${nip19.npubEncode(publicKey)} — Clic para editar perfil`}
              >
                <span className="header-identity-avatar">
                  {myProfile?.picture ? (
                    <img src={myProfile.picture} alt="" />
                  ) : (
                    (myProfile?.name ?? myProfile?.display_name ?? '?').charAt(0).toUpperCase() || '?'
                  )}
                </span>
                <span className="truncate">
                  {myProfile?.nip05 ?? myProfile?.display_name ?? myProfile?.name ?? (nip19.npubEncode(publicKey).slice(0, 10) + '…')}
                </span>
              </button>
              <span className="header-controls-divider" aria-hidden />
              <ThemeSelector currentTheme={theme} onThemeChange={setTheme} />
              <Notifications
                onNotificationChange={() => {}}
                onRegisterShow={(show) => { showNotificationRef.current = show; }}
                publicKey={publicKey}
              />
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text-color)] px-2 py-1.5 rounded hover:bg-[var(--sidebar-hover)] transition-colors"
                title="Cerrar sesión"
              >
                Salir
              </button>
            </div>
        )}
      </header>
      {showProfileEditor && pool && privateKey && publicKey && (
        <ProfileEditor
          pool={pool}
          privateKey={privateKey}
          publicKey={publicKey}
          currentProfile={myProfile}
          onSaved={(p: ProfileForm) => setMyProfile({ name: p.name, display_name: p.display_name, nip05: p.nip05, picture: p.picture })}
          onClose={() => setShowProfileEditor(false)}
        />
      )}
      <main className="flex-1 min-h-0 flex p-2 sm:p-4 overflow-hidden">
        {privateKey && publicKey && pool ? (
          <>
            <div className="w-64 max-w-[42vw] shrink-0 sidebar-bg chat-sidebar-panel flex flex-col min-h-0 overflow-hidden relative">
              <ChannelList
                channels={channels}
                selectedChannelId={selectedChannelId}
                unifiedFeed={unifiedFeed}
                onSelectChannel={(id) => {
                  setSelectedChannelId(id);
                  setUnifiedFeed(false);
                  if (id) setSelectedContact(null);
                }}
                onSelectUnified={() => {
                  setUnifiedFeed(true);
                  setSelectedChannelId(null);
                  setSelectedContact(null);
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
                  setUnifiedFeed(false);
                }}
              />
              <RelayStatus pool={pool} />
            </div>
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden chat-bg chat-main-panel">
              <Chat
                privateKey={privateKey}
                publicKey={publicKey}
                pool={pool}
                selectedContact={selectedContact}
                selectedChannelId={selectedChannelId}
                channelName={selectedChannelId ? channels.find((c) => c.id === selectedChannelId)?.name : undefined}
                unifiedFeed={unifiedFeed}
                channels={channels}
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
    </div>
  );
}

export default App;
