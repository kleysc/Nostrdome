import { type ReactNode } from 'react';
import { useAppStore } from '../../stores/store';
import ServerBar from './ServerBar';
import MemberSidebar from './MemberSidebar';

interface AppShellProps {
  publicKey: string | null;
  onOpenProfile: () => void;
  onLogout: () => void;
  channelSidebar: ReactNode;
  chatPanel: ReactNode;
}

// 3-column shell (server bar / channel sidebar / chat / member sidebar).
// Member sidebar collapses below 900px. Real region content (channel list
// with categories, member roster) gets richer in §1.4 and §1.5; this
// component just owns the layout and the always-on "Coming in F2" modal.
export default function AppShell({
  publicKey,
  onOpenProfile,
  onLogout,
  channelSidebar,
  chatPanel,
}: AppShellProps) {
  const isComingModalOpen = useAppStore((s) => s.isMultiServerComingModalOpen);
  const closeComingModal = useAppStore((s) => s.closeComingModal);

  return (
    <div className="flex flex-1 min-h-0 app-theme">
      <ServerBar
        publicKey={publicKey}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
      <aside
        className="w-60 shrink-0 flex flex-col min-h-0 sidebar-bg chat-sidebar-panel border-r border-[var(--border-subtle)]"
        aria-label="Canales"
      >
        {channelSidebar}
      </aside>
      <main className="flex-1 min-w-0 min-h-0 flex flex-col chat-bg chat-main-panel">
        {chatPanel}
      </main>
      <MemberSidebar />

      {isComingModalOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeComingModal}
        >
          <div
            className="max-w-sm w-full rounded-lg border border-[var(--border-subtle)] p-6 shadow-xl"
            style={{ backgroundColor: 'var(--header-bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2 text-[var(--text-color)]">
              Multi-servidor llega en F2
            </h2>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              En esta versión Nostrdome opera con una comunidad por instalación.
              La capacidad de pertenecer a varias comunidades con la misma
              identidad llega en la siguiente fase.
            </p>
            <button
              type="button"
              onClick={closeComingModal}
              className="px-4 py-2 rounded bg-[var(--primary-color)] text-white text-sm font-medium hover:opacity-90"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
