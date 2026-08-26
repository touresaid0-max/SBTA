import { useEffect, useRef } from 'react';
import { useConnection } from './ConnectionContext';
import { flushSyncQueue, getPendingCount, onOnlineChange } from './syncEngine';
import { syncDepartsAndTicketsFromServer } from './offlineStore';
import { refreshAllReferentiels } from './referentiels';

/**
 * Hook that drives automatic synchronization:
 * - Listens for online/offline transitions
 * - On reconnection: flushes the sync queue, pulls server changes, refreshes referentiels
 * - Updates the ConnectionContext with pending count and sync status
 * - Polls pending count periodically to keep the banner accurate
 */
export function useAutoSync(stationId?: string) {
  const { status, setSyncing, setPendingCount, setLastSyncedAt } = useConnection();
  const lastStatusRef = useRef(status);

  // Update pending count whenever status changes or periodically
  useEffect(() => {
    let mounted = true;

    const updatePending = async () => {
      const count = await getPendingCount();
      if (mounted) setPendingCount(count);
    };

    updatePending();
    const interval = setInterval(updatePending, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [status, setPendingCount]);

  // Listen for online/offline transitions from the sync engine
  useEffect(() => {
    const unsub = onOnlineChange(async (online) => {
      if (online) {
        setSyncing(true);
        try {
          await flushSyncQueue();
          await syncDepartsAndTicketsFromServer(stationId);
          try { await refreshAllReferentiels(); } catch { /* non-critical */ }
          setLastSyncedAt(new Date().toISOString());
        } finally {
          setSyncing(false);
          const count = await getPendingCount();
          setPendingCount(count);
        }
      }
    });
    return unsub;
  }, [stationId, setSyncing, setLastSyncedAt, setPendingCount]);

  // Also trigger sync when ConnectionContext detects online transition
  useEffect(() => {
    if (lastStatusRef.current === 'offline' && status === 'online') {
      setSyncing(true);
      (async () => {
        try {
          await flushSyncQueue();
          await syncDepartsAndTicketsFromServer(stationId);
          try { await refreshAllReferentiels(); } catch { /* non-critical */ }
          setLastSyncedAt(new Date().toISOString());
        } finally {
          setSyncing(false);
          const count = await getPendingCount();
          setPendingCount(count);
        }
      })();
    }
    lastStatusRef.current = status;
  }, [status, stationId, setSyncing, setLastSyncedAt, setPendingCount]);
}
