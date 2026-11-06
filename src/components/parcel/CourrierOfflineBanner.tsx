import { SyncStatusBanner } from '@/components/shared/SyncStatusBanner';
import type { ConnectionStatus } from '@/services/courrier/ConnectionContext';

interface OfflineBannerProps {
  status: ConnectionStatus;
  syncing: boolean;
  pendingCount: number;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  onShowQueue: () => void;
}

/**
 * Sending state of the courrier, shown like the guichet's sale (same strip, colours and words):
 * the operations leave by themselves, the strip opens the list of those not yet on the server.
 */
export function CourrierOfflineBanner({ status, syncing, pendingCount, lastSyncError, lastSyncedAt, onShowQueue }: OfflineBannerProps) {
  return (
    <SyncStatusBanner
      state={{ status, syncing, pendingCount, lastSyncError, lastSyncedAt }}
      onOpenQueue={onShowQueue}
    />
  );
}
