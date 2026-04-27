// Root layout for the routed shell. Owns:
//  • Pool init and lifecycle
//  • Theme application to <html data-theme="…">
//  • Loading legacy NIP-28 channels and NIP-02 contacts (placeholder data
//    until §1.4 wires real NIP-29 community state)
//  • Loading kind 0 profile of the logged-in user
//  • Toast for cross-cutting notifications
//  • Profile editor modal
//
// Renders <Outlet> with this state available to children via outlet context.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  SimplePool, getPublicKey, generatePrivateKey, nip19, type Event,
  getEventHash, getSignature,
} from 'nostr-tools';
import { useAppStore } from '../../stores/store';
import { relayUrls } from '../../config';
import { useBackgroundUnread } from '../../hooks/useBackgroundUnread';
import Notifications, { type ShowNotificationFn } from '../Notifications';
import ProfileEditor, { type ProfileForm } from '../ProfileEditor';
import type { Contact, Channel, MyProfile, RootContext } from './context';

export default function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const privateKey = useAppStore((s) => s.privateKey);
  const publicKey = useAppStore((s) => s.publicKey);
  const setKeys = useAppStore((s) => s.setKeys);
  const logout = useAppStore((s) => s.logout);
  const theme = useAppStore((s) => s.theme);

  const [pool, setPool] = useState<SimplePool | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  const pendingNicknameRef = useRef<string | null>(null);
  const showNotificationRef = useRef<ShowNotificationFn | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply theme to <html> for CSS variables.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Background unread tracker: opens one auth'd NIP-29 sub per joined,
  // non-active, non-muted server so the server bar can show numeric
  // badges for activity in communities the user isn't currently viewing.
  useBackgroundUnread({ privateKey });

  // Derive publicKey from stored privateKey on boot.
  useEffect(() => {
    if (privateKey && !publicKey) {
      setKeys(privateKey, getPublicKey(privateKey));
    }
  }, [privateKey, publicKey, setKeys]);

  // Pool lifecycle.
  useEffect(() => {
    const p = new SimplePool();
    setPool(p);
    return () => { p.close(relayUrls); };
  }, []);

  // Notifications hub used by Chat to trigger toasts.
  const handleNotify = useCallback(
    (title: string, body: string, data?: { messageId?: string; type?: string }) => {
      showNotificationRef.current?.(title, body, data);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToast({ title, body });
      toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
    },
    [],
  );

  // Legacy NIP-28 channel discovery (kind 40) — replaced by NIP-29 in §1.4.
  const loadChannels = useCallback((p: SimplePool) => {
    const sub = p.sub(relayUrls, [{ kinds: [40], limit: 100 }]);
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
          id: event.id, name: 'Sin nombre', pubkey: event.pubkey, created_at: event.created_at,
        };
      }
    });
    sub.on('eose', () => {
      sub.unsub();
      setChannels(Object.values(byId).sort((a, b) => b.created_at - a.created_at));
    });
  }, []);

  // Legacy NIP-02 contacts.
  const loadContacts = useCallback((p: SimplePool, pk: string) => {
    const sub = p.sub(relayUrls, [{ kinds: [3], authors: [pk], limit: 1 }]);
    sub.on('event', (event: Event) => {
      const pubkeys = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
      const petnames: Record<string, string> = {};
      event.tags.forEach((t) => { if (t[0] === 'p' && t[3]) petnames[t[1]] = t[3]; });
      if (pubkeys.length === 0) { setContacts([]); return; }
      const sub0 = p.sub(relayUrls, [{ kinds: [0], authors: pubkeys }]);
      const meta: Record<string, { name?: string; display_name?: string; nip05?: string; about?: string }> = {};
      sub0.on('event', (e: Event) => {
        try {
          const d = JSON.parse(e.content || '{}');
          meta[e.pubkey] = { name: d.name, display_name: d.display_name, nip05: d.nip05, about: d.about };
        } catch {}
      });
      sub0.on('eose', () => {
        sub0.unsub();
        setContacts(pubkeys.map((p) => ({
          pubkey: p,
          name: meta[p]?.nip05 ?? meta[p]?.display_name ?? meta[p]?.name ?? petnames[p] ?? nip19.npubEncode(p).slice(0, 12) + '…',
          about: meta[p]?.about,
        })));
      });
    });
    sub.on('eose', () => sub.unsub());
  }, []);

  useEffect(() => { if (pool && publicKey) loadContacts(pool, publicKey); }, [pool, publicKey, loadContacts]);
  useEffect(() => { if (pool) loadChannels(pool); }, [pool, loadChannels]);

  // kind 0 profile + pending nickname publication on first login.
  useEffect(() => {
    if (!pool || !publicKey) { setMyProfile(null); return; }
    const priv = privateKey;
    const pendingNick = pendingNicknameRef.current;
    if (priv && pendingNick) {
      pendingNicknameRef.current = null;
      const content = JSON.stringify({ name: pendingNick });
      const event: Event = {
        kind: 0, pubkey: publicKey, created_at: Math.floor(Date.now() / 1000),
        tags: [], content, id: '', sig: '',
      };
      event.id = getEventHash(event);
      event.sig = getSignature(event, priv);
      Promise.all(pool.publish(relayUrls, event)).catch(() => {});
      setMyProfile((p) => ({ ...p, name: pendingNick }));
    }
    const sub = pool.sub(relayUrls, [{ kinds: [0], authors: [publicKey], limit: 1 }]);
    sub.on('event', (event: Event) => {
      try {
        const d = JSON.parse(event.content || '{}');
        setMyProfile({ name: d.name, display_name: d.display_name, nip05: d.nip05, picture: d.picture });
      } catch { setMyProfile(null); }
    });
    sub.on('eose', () => sub.unsub());
    return () => sub.unsub();
  }, [pool, publicKey, privateKey]);

  // Auth-driven redirects.
  useEffect(() => {
    const onLogin = location.pathname === '/login';
    if (privateKey && publicKey && onLogin) {
      navigate('/c/legacy', { replace: true });
    } else if (!privateKey && !onLogin) {
      navigate('/login', { replace: true });
    }
  }, [privateKey, publicKey, location.pathname, navigate]);

  // Login handler exposed via outlet context for the LoginRoute.
  const handleLogin = useCallback((inputPrivateKey: string, initialNickname?: string) => {
    if (initialNickname?.trim()) pendingNicknameRef.current = initialNickname.trim();
    const priv = inputPrivateKey || generatePrivateKey();
    setKeys(priv, getPublicKey(priv));
  }, [setKeys]);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const ctx: RootContext = {
    pool, contacts, channels, myProfile,
    onNotify: handleNotify,
    onOpenProfile: () => setShowProfileEditor(true),
    onLogout: handleLogout,
    onLogin: handleLogin,
    reloadChannels: () => { if (pool) loadChannels(pool); },
  };

  return (
    <div className="h-screen app-theme flex flex-col overflow-hidden">
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4 px-4 py-3 rounded-lg shadow-lg border flex items-start gap-3"
          style={{ backgroundColor: 'var(--header-bg)', borderColor: 'var(--primary-color)', color: 'var(--text-color)' }}
          role="alert"
        >
          <span className="shrink-0 text-lg">🔔</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{toast.title}</div>
            <div className="text-sm opacity-90 truncate" title={toast.body}>{toast.body}</div>
          </div>
          <button type="button" onClick={() => setToast(null)} className="shrink-0 opacity-70 hover:opacity-100 p-1" aria-label="Cerrar">✕</button>
        </div>
      )}

      {/* Notifications API host (legacy bell + permission flow). */}
      {publicKey && (
        <Notifications
          onNotificationChange={() => {}}
          onRegisterShow={(show) => { showNotificationRef.current = show; }}
          publicKey={publicKey}
        />
      )}

      {showProfileEditor && pool && privateKey && publicKey && (
        <ProfileEditor
          pool={pool}
          privateKey={privateKey}
          publicKey={publicKey}
          currentProfile={myProfile}
          onSaved={(p: ProfileForm) =>
            setMyProfile({ name: p.name, display_name: p.display_name, nip05: p.nip05, picture: p.picture })
          }
          onClose={() => setShowProfileEditor(false)}
        />
      )}

      <Outlet context={ctx} />
    </div>
  );
}
