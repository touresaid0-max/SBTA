import { useConnection } from '@/services/pos/ConnectionContext';
import { SyncQueueModal } from '@/components/pos/SyncQueueModal';
import { SyncStatusBanner } from '@/components/shared/SyncStatusBanner';

export function ConnectionBanner() {
  const { status, sessionExpired, syncing, pendingCount, lastSyncError, lastSyncedAt, offlineReady, queueOpen, setQueueOpen } = useConnection();

  return (
    <>
      <SyncStatusBanner
        state={{ status, sessionExpired, syncing, pendingCount, lastSyncError, lastSyncedAt, offlineReady }}
        onOpenQueue={() => setQueueOpen(true)}
      />
      <SyncQueueModal open={queueOpen} onClose={() => setQueueOpen(false)} />
    </>
  );
}
