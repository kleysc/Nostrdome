import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import RootLayout from './components/shell/RootLayout';
import ChannelView from './components/shell/ChannelView';
import InviteJoinView from './components/shell/InviteJoinView';
import LiveCommunityView from './components/shell/LiveCommunityView';
import LoginRoute from './components/shell/LoginRoute';
import { useAppStore } from './stores/store';

// Branches `/c/:groupId{/...}` based on whether the groupId is the legacy
// sentinel (renders the existing NIP-28 UI) or any other value (renders
// the NIP-29 live community pipeline).
function GroupRouter() {
  const { groupId } = useParams<{ groupId: string }>();
  const privateKey = useAppStore((s) => s.privateKey);
  const publicKey = useAppStore((s) => s.publicKey);
  if (!privateKey || !publicKey) return null;
  if (groupId === 'legacy') return <ChannelView />;
  return (
    <LiveCommunityView
      publicKey={publicKey}
      privateKey={privateKey}
      onOpenProfile={() => { /* RootLayout handles this via outlet ctx */ }}
      onLogout={() => { /* idem */ }}
    />
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/c/legacy" replace /> },
      { path: 'login', element: <LoginRoute /> },
      { path: 'c/:groupId', element: <GroupRouter /> },
      { path: 'c/:groupId/:channelId', element: <GroupRouter /> },
      { path: 'c/:groupId/:channelId/:messageId', element: <GroupRouter /> },
      { path: 'c/:groupId/admin', element: <div className="p-8 text-[var(--text-muted)]">Mod dashboard — llega en F5</div> },
      { path: 'dm/:pubkey', element: <div className="p-8 text-[var(--text-muted)]">DMs cross-server — llega en F2</div> },
      { path: 'invite/:token', element: <InviteJoinView /> },
      { path: '*', element: <Navigate to="/c/legacy" replace /> },
    ],
  },
]);
