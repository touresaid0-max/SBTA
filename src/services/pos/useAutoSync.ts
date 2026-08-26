import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './ConnectionContext';
import { flushSyncQueue, getPendingCount, onOnlineChange, isOnline, getLastSyncError } from './syncEngine';
import { syncDepartsAndTicketsFromServer } from './offlineStore';
import { refreshAllReferentiels } from './referentiels';
import { ensureAuthSession } from './offlineAuth';

export function useAutoSync(stationId?: string) {
  const {
    status,
    setSyncing,
    setPendingCount,
    setLastSyncedAt,
    setLastSyncError,
  } = useConnection();
  const runningRef = useRef(false);
  const stationRef = useRef(stationId);
  stationRef.current = stationId;

  const updateQueueState = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
    setLastSyncError(await getLastSyncError());
    return count;
  }, [setLastSyncError, setPendingCount]);

  const runSync = useCallback(async () => {
    if (runningRef.current || !isOnline()) {
      await updateQueueState();
      return;
    }

    runningRef.current = true;
    setSyncing(true);
    setLastSyncError(null);

    try {
      // Before flushing, ensure the Supabase auth session is still valid.
      // After a long offline period the access token may have expired.
      const authValid = await ensureAuthSession();
      if (!authValid) {
        setLastSyncError('Session expirée. Veuillez vous reconnecter pour synchroniser les opérations en attente.');
        await updateQueueState();
        return;
      }

      const result = await flushSyncQueue();
      if (!isOnline()) return;

      await syncDepartsAndTicketsFromServer(stationRef.current);
      try {
        await refreshAllReferentiels();
      } catch {
        // Reference data refresh is non-critical for the queued operations.
      }

      const remaining = await updateQueueState();
      if (result.failed === 0 && result.conflicts.length === 0 && remaining === 0) {
        setLastSyncedAt(new Date().toISOString());
      }
    } catch (error) {
      setLastSyncError(error instanceof Error ? error.message : 'Erreur inconnue pendant la synchronisation');
      await updateQueueState();
    } finally {
      runningRef.current = false;
      setSyncing(false);
    }
  }, [setLastSyncError, setLastSyncedAt, setSyncing, updateQueueState]);

  useEffect(() => {
    const unsubscribe = onOnlineChange((online) => {
      if (online) void runSync();
    });
    return unsubscribe;
  }, [runSync]);

  useEffect(() => {
    if (status === 'online') void runSync();
  }, [runSync, status]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (status === 'online') void runSync();
      else void updateQueueState();
    }, 5000);
    return () => clearInterval(interval);
  }, [runSync, status, updateQueueState]);
}
