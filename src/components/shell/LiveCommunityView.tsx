// Route element for `/c/:groupId{/:channelId/:messageId}` when groupId is
// NOT the legacy sentinel. Spins up the live relay connection, subscribes
// to community kinds, renders the new sidebar + chat placeholder.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import AppShell from './AppShell';
import CommunitySidebar from './CommunitySidebar';
import CreateChannelModal from './CreateChannelModal';
import EditCommunityModal from './EditCommunityModal';
import LiveChatPanel from './LiveChatPanel';
import MemberPanel from './MemberPanel';
import { useAppStore, useLive, useLiveError, useLiveStatus } from '../../stores/store';
import { useServers } from '../../stores/servers';
import { useLiveCommunity } from '../../hooks/useLiveCommunity';
import { useMemberProfiles } from '../../hooks/useMemberProfiles';
import { usePresence } from '../../hooks/usePresence';
import { liveRelayUrl, relayUrls } from '../../config';
import type { RootContext } from './context';

interface LiveCommunityViewProps {
  publicKey: string;
  privateKey: string;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export default function LiveCommunityView({
  publicKey, privateKey, onOpenProfile, onLogout,
}: LiveCommunityViewProps) {
  const { groupId = '', channelId } = useParams<{ groupId: string; channelId?: string }>();
  const { pool } = useOutletContext<RootContext>();
  const { liveRelay } = useLiveCommunity({ groupId, relayUrl: liveRelayUrl, privateKey });
  const live = useLive(groupId);
  const liveStatus = useLiveStatus(groupId);
  const liveError = useLiveError(groupId);
  const selectedMember = useAppStore((s) => s.selectedMemberPubkey);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const setActiveServer = useServers((s) => s.setActive);
  const markServerRead = useServers((s) => s.markRead);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Push the active community into both stores: the main one (for chrome
  // without route params like MemberSidebar) and the servers slice (so the
  // server bar highlights the active icon and clears its unread badge).
  // Cleared on unmount so navigating to /c/legacy or /login doesn't leave
  // a stale active group around.
  useEffect(() => {
    setActiveGroup(groupId);
    setActiveServer(groupId);
    markServerRead(groupId);
    return () => {
      setActiveGroup(null);
      setActiveServer(null);
    };
  }, [groupId, setActiveGroup, setActiveServer, markServerRead]);

  // Pull member pubkeys for kind 0 batching. Recomputed only when members
  // array reference changes; useMemberProfiles itself dedupes/sorts internally.
  const memberPubkeys = useMemo(() => live.members.map((m) => m.pubkey), [live.members]);
  useMemberProfiles({ pool, relays: relayUrls, pubkeys: memberPubkeys });
  usePresence({ liveRelay, groupId, privateKey, myPubkey: publicKey });

  const channel = live.channels.find((c) => c.id === channelId);

  return (
    <>
      <AppShell
        publicKey={publicKey}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
        channelSidebar={
          <CommunitySidebar
            groupId={groupId}
            publicKey={publicKey}
            onCreateChannel={() => setCreateOpen(true)}
            onEditCommunity={() => setEditOpen(true)}
          />
        }
        chatPanel={
          channel ? (
            <LiveChatPanel
              groupId={groupId}
              channel={channel}
              liveRelay={liveRelay}
              privateKey={privateKey}
              publicKey={publicKey}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] p-8 text-center">
              <div className="max-w-sm space-y-2">
                <h2 className="text-base font-semibold text-[var(--text-color)]">
                  {live.metadata?.name ?? groupId}
                </h2>
                <p className="text-sm opacity-70">
                  Seleccioná un canal del sidebar para empezar a leer.
                </p>
                {liveStatus === 'error' && (
                  <p className="text-sm text-red-400">{liveError}</p>
                )}
              </div>
            </div>
          )
        }
      />
      {createOpen && liveRelay && (
        <CreateChannelModal
          groupId={groupId}
          liveRelay={liveRelay}
          privateKey={privateKey}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editOpen && liveRelay && (
        <EditCommunityModal
          groupId={groupId}
          liveRelay={liveRelay}
          privateKey={privateKey}
          publicKey={publicKey}
          onClose={() => setEditOpen(false)}
        />
      )}
      {selectedMember && (
        <MemberPanel
          groupId={groupId}
          liveRelay={liveRelay}
          privateKey={privateKey}
          publicKey={publicKey}
        />
      )}
    </>
  );
}
