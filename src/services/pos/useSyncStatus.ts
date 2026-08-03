import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from './db';
import {
  syncNow,
  onSyncEvent,
  isSyncing,
  checkOnlineStatus,
  getErrorItems,
  type SyncErrorDetail,
} from './syncService';

export function useSyncStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [syncErrors, setSyncErrors] = useState<SyncErrorDetail[]>([]);
  const [syncing, setSyncing] = useState(isSyncing());
  const [lastSync, setLastSync] = useState(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const refreshPending = useCallback(async () => {
    if (!isMounted.current) return;
    const count = await db.sync_queue.where('status').anyOf(['pending', 'error']).count();
    const errors = await getErrorItems();
    setPendingCount(count);
    setErrorCount(errors.length);
    setSyncErrors(errors);
  }, []);

  const tryAutoSync = useCallback(async () => {
    if (!isMounted.current) return;
    if (isSyncing()) return;
    const online = await checkOnlineStatus();
    if (!online) return;
    const pending = await db.sync_queue.where('status').anyOf(['pending', 'error']).count();
    if (pending > 0) {
      await syncNow();
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    isMounted.current = true;

    const goOnline = () => {
      setIsOnline(true);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => tryAutoSync(), 500);
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    refreshPending();

    const unsub = onSyncEvent((event) => {
      if (!isMounted.current) return;
      if (event === 'start') setSyncing(true);
      if (event === 'done' || event === 'idle') {
        setSyncing(false);
        setLastSync(Date.now());
        refreshPending();
      }
      if (event === 'item-ok' || event === 'item-error') {
        refreshPending();
      }
      if (event === 'errors-updated') {
        refreshPending();
      }
    });

    checkOnlineStatus().then((online) => {
      if (!isMounted.current) return;
      setIsOnline(online);
      if (online) tryAutoSync();
    });

    const interval = setInterval(async () => {
      if (!isMounted.current) return;
      if (isSyncing()) return;
      const online = await checkOnlineStatus();
      setIsOnline(online);
      if (online) tryAutoSync();
    }, 15000);

    return () => {
      isMounted.current = false;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      unsub();
      clearInterval(interval);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [refreshPending, tryAutoSync]);

  const triggerSync = useCallback(async () => {
    const result = await syncNow();
    await refreshPending();
    return result;
  }, [refreshPending]);

  return {
    isOnline,
    pendingCount,
    errorCount,
    syncErrors,
    syncing,
    lastSync,
    triggerSync,
    refreshPending,
  };
}
