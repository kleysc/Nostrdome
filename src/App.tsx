import { useState, useEffect } from 'react';
import { SimplePool, getPublicKey, generatePrivateKey, nip19 } from 'nostr-tools';
import Chat from './components/Chat';
import Login from './components/Login';
import { relayUrls } from './config';

function App() {
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [pool, setPool] = useState<SimplePool | null>(null);

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
    <div className="min-h-screen bg-black text-green-500 font-mono flex flex-col">
      <header className="fixed top-0 left-0 right-0 bg-green-900 p-4 z-10">
        <h1 className="text-2xl">Nostr Chat</h1>
        {publicKey && (
          <div className="flex justify-between items-center">
            <p className="text-sm">Public Key: {nip19.npubEncode(publicKey)}</p>
            <button
              onClick={handleLogout}
              className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
            >
              Logout
            </button>
          </div>
        )}
      </header>
      <main className="flex-grow p-4 pt-16"> {/* Agregar padding-top para evitar que el contenido se superponga con el header */}
        {privateKey && publicKey && pool ? (
          <Chat privateKey={privateKey} publicKey={publicKey} pool={pool} />
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </main>
    </div>
  );
}

export default App;