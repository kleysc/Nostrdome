import React, { useState, useEffect } from 'react';
import { SimplePool } from 'nostr-tools';
import { relayUrls } from '../config';

interface RelayStatusProps {
  pool: SimplePool;
}

interface RelayState {
  url: string;
  status: boolean;
  lastChecked: number;
}

const RelayStatus: React.FC<RelayStatusProps> = ({ pool }) => {
  const [relayStates, setRelayStates] = useState<RelayState[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const checkRelayStatus = async () => {
      const newStates = await Promise.all(
        relayUrls.map(async (url) => {
          try {
            const relay = await pool.ensureRelay(url);
            return {
              url,
              status: relay.status === 1,
              lastChecked: Date.now()
            };
          } catch (error) {
            return {
              url,
              status: false,
              lastChecked: Date.now()
            };
          }
        })
      );

      setRelayStates(prevStates => {
        // Detectar cambios en el estado de los relays
        const hasStateChanges = newStates.some(newState => {
          const prevState = prevStates.find(ps => ps.url === newState.url);
          return prevState && prevState.status !== newState.status;
        });

        if (hasStateChanges) {
          setHasChanges(true);
          setIsVisible(true);
        }

        return newStates;
      });
    };

    // Verificación inicial
    checkRelayStatus();

    // Verificar cada 30 segundos
    const interval = setInterval(checkRelayStatus, 30000);
    
    return () => clearInterval(interval);
  }, [pool]);

  const handleClose = () => {
    setIsVisible(false);
    setHasChanges(false);
  };

  if (!isVisible && !hasChanges) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-gray-700 p-2 rounded-full hover:bg-gray-600"
        title="Show Relay Status"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12zm10-1h2v2h-2v-2zm0-6h2v4h-2V5z"/>
        </svg>
      </button>
    );
  }

  return (
    <div className="bg-gray-800 p-3 rounded-lg shadow-lg max-w-[200px] animate-fade-in">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold">Relay Status</h3>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-200 text-sm"
        >
          ✕
        </button>
      </div>
      <div className="space-y-1">
        {relayStates.map((relay) => (
          <div key={relay.url} className="flex items-center gap-2 text-xs">
            <div 
              className={`w-1.5 h-1.5 rounded-full ${
                relay.status ? 'bg-green-500' : 'bg-red-500'
              } ${
                hasChanges && 'animate-pulse'
              }`}
            />
            <span className="truncate" title={relay.url}>
              {new URL(relay.url).hostname}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RelayStatus; 