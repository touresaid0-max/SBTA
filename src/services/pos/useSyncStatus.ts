import { useState, useEffect, useCallback } from 'react';
import { db } from './db';
import { syncNow, onSyncEvent, isSyncing } from './syncService';

export function useSyncStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(isSyncing());
  const [lastSync, setLastSync] = useState(0);

  const refreshPending = useCallback(async () => {
    const count = await db.sync_queue.where('status').anyOf(['pending', 'error']).count();
    setPendingCount(count);
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      setTimeout(() => syncNow().then(() => refreshPending()), 500);
    };
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    refreshPending();

    const unsub = onSyncEvent((event, detail) => {
      if (event === 'start') setSyncing(true);
      if (event === 'done' || event === 'idle') {
        setSyncing(false);
        setLastSync(Date.now());
        refreshPending();
      }
      if (event === 'item-ok' || event === 'item-error') {
        refreshPending();
      }
      void detail;
    });

    if (navigator.onLine && !isSyncing()) {
      const pending = db.sync_queue.where('status').anyOf(['pending', 'error']).count();
      pending.then(c => { if (c > 0) syncNow().then(() => refreshPending()); });
    }

    const interval = setInterval(refreshPending, 5000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      unsub();
      clearInterval(interval);
    };
  }, [refreshPending]);

  const triggerSync = useCallback(async () => {
    const result = await syncNow();
    await refreshPending();
    return result;
  }, [refreshPending]);

  return { isOnline, pendingCount, syncing, lastSync, triggerSync, refreshPending };
}
