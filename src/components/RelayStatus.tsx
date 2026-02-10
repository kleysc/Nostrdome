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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const checkRelayStatus = async () => {
      const newStates = await Promise.all(
        relayUrls.map(async (url) => {
          try {
            const relay = await pool.ensureRelay(url);
            return { url, status: relay.status === 1, lastChecked: Date.now() };
          } catch {
            return { url, status: false, lastChecked: Date.now() };
          }
        })
      );
      setRelayStates(newStates);
    };

    checkRelayStatus();
    const interval = setInterval(checkRelayStatus, 30000);
    return () => clearInterval(interval);
  }, [pool]);

  const connected = relayStates.filter((r) => r.status).length;
  const total = relayStates.length;
  const allConnected = connected === total && total > 0;

  return (
    <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--header-bg)] relative">
      {/* Panel expandido (hacia arriba) */}
      {expanded && (
        <div className="absolute bottom-full left-0 right-0 z-30 p-3 bg-[var(--sidebar-bg)] border border-[var(--border-subtle)] border-b-0 rounded-t-lg shadow-lg">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Relays conectados
          </h4>
          <div className="space-y-1.5">
            {relayStates.map((relay) => (
              <div key={relay.url} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    relay.status ? 'bg-green-500' : 'bg-red-500'
                  }`}
                />
                <span className="truncate text-[var(--text-color)]" title={relay.url}>
                  {new URL(relay.url).hostname}
                </span>
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">
                  {relay.status ? 'OK' : 'Off'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barra compacta */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-color)] hover:bg-[var(--sidebar-hover)] transition-colors"
        title={`${connected}/${total} relays conectados`}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            allConnected ? 'bg-green-500' : connected > 0 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
        />
        <span>
          {total === 0
            ? 'Sin relays'
            : allConnected
              ? `${connected} relays conectados`
              : `${connected}/${total} relays`}
        </span>
        <svg
          className={`w-3 h-3 ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
};

export default RelayStatus;
