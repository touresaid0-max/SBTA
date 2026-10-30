import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './ConnectionContext';
import { flushSyncQueue, getPendingCount, onOnlineChange, isOnline, getLastSyncError } from './syncEngine';
import { syncDepartsAndTicketsFromServer } from './offlineStore';
import { refreshAllReferentiels } from './referentiels';
import { ensureAuthSession } from './offlineAuth';

// Sending queued sales stays fast; pulling server data is spaced out to spare the database.
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
      // 1. Send the operations recorded on this device (sales, cancellations…), if any
      let result = { failed: 0, conflicts: [] as unknown[] };
      if (await getPendingCount() > 0) {
        // Before flushing, ensure the Supabase auth session is still valid.
        // After a long offline period the access token may have expired.
        const authValid = await ensureAuthSession();
        if (!authValid) {
          setLastSyncError('Session expirée. Veuillez vous reconnecter pour synchroniser les opérations en attente.');
          await updateQueueState();
          return;
        }
        result = await flushSyncQueue();
        if (!isOnline()) return;
      }

      // 2. Pull this station's departures and tickets, only while the page is on screen
      const now = Date.now();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (force || (visible && now - lastPullRef.current >= PULL_INTERVAL_MS)) {
        lastPullRef.current = now;
        await syncDepartsAndTicketsFromServer(stationRef.current);
      }

      // 3. Reference data (lines, buses, drivers, fares, stations) changes rarely
      if (force || now - lastReferentielsRef.current >= REFERENTIELS_INTERVAL_MS) {
        lastReferentielsRef.current = now;
        try {
          await refreshAllReferentiels();
        } catch {
          // Reference data refresh is non-critical for the queued operations.
        }
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

  // Back on screen after a while: catch up at once instead of waiting for the next pull
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && status === 'online') void runSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [runSync, status]);
}
