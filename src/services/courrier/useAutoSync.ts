import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './ConnectionContext';
import { flushSyncQueue, getPendingCount, onOnlineChange, isOnline, getLastSyncError, recoverUnqueuedRecords } from './syncEngine';
import { syncParcelsFromServer } from './offlineStore';
import { ensureAuthSession } from './offlineAuth';
import { refreshAllReferentiels } from './referentiels';

// Like the guichet's sales: queued operations leave fast, server data is pulled less often
// (it used to be the whole parcel history every 5 seconds).
const SEND_INTERVAL_MS = 5_000;
const PULL_INTERVAL_MS = 30_000;
const REFERENTIELS_INTERVAL_MS = 10 * 60_000;

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
  const lastPullRef = useRef(0);
  const lastReferentielsRef = useRef(0);

  const updateQueueState = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
    setLastSyncError(await getLastSyncError());
    return count;
  }, [setLastSyncError, setPendingCount]);

  // force: pull and refresh reference data now (on start, on reconnection)
  const runSync = useCallback(async (force = false) => {
    if (runningRef.current || !isOnline()) {
      await updateQueueState();
      return;
    }

    runningRef.current = true;
    setSyncing(true);
    setLastSyncError(null);

    try {
      let result = { failed: 0, conflicts: [] as unknown[] };
      // Parcels whose send was cut before this version, in no queue: queued again (once per session)
      await recoverUnqueuedRecords().catch(() => { /* tried again at the next sync */ });
      if (await getPendingCount() > 0) {
        const authValid = await ensureAuthSession();
        if (!authValid) {
          setLastSyncError('Session expirée. Veuillez vous reconnecter pour synchroniser les opérations en attente.');
          await updateQueueState();
          return;
        }
        result = await flushSyncQueue();
        if (!isOnline()) return;
      }

      const now = Date.now();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (force || (visible && now - lastPullRef.current >= PULL_INTERVAL_MS)) {
        lastPullRef.current = now;
        await syncParcelsFromServer(stationRef.current);
      }
      if (force || now - lastReferentielsRef.current >= REFERENTIELS_INTERVAL_MS) {
        lastReferentielsRef.current = now;
        await refreshAllReferentiels(stationRef.current);
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
      if (online) void runSync(true);
    });
    return unsubscribe;
  }, [runSync]);

  useEffect(() => {
    if (status === 'online') void runSync(true);
  }, [runSync, status]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (status === 'online') void runSync();
      else void updateQueueState();
    }, SEND_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runSync, status, updateQueueState]);
}
