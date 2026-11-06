import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { pingServer, setSessionRenewal } from '@/services/supabase';
import { syncBannerLabel } from '@/components/shared/SyncStatusBanner';
import { setOnline as setSyncEngineOnline } from './syncEngine';
import { applyDataRetention } from '@/services/offline/dataRetention';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

export interface ConnectionState {
  status: ConnectionStatus;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  bannerLabel: string;
  setSyncing: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (iso: string) => void;
  setLastSyncError: (message: string | null) => void;
  recheck: () => void;
}

const ConnectionContext = createContext<ConnectionState>({
  status: 'checking',
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  lastSyncError: null,
  bannerLabel: '',
  setSyncing: () => {},
  setPendingCount: () => {},
  setLastSyncedAt: () => {},
  setLastSyncError: () => {},
  recheck: () => {},
});

const PING_INTERVAL_MS = 15_000;

/** Without the login session: offline, a check through the client waited for its renewal (see pingServer). */
async function pingSupabase(): Promise<boolean> {
  return pingServer();
}

export function ConnectionProvider({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doCheck = useCallback(async () => {
    const reachable = await pingSupabase();
    setSyncEngineOnline(reachable);
    setSessionRenewal(reachable);
    setStatus(reachable ? 'online' : 'offline');
    return reachable;
  }, []);

  const recheck = useCallback(() => { void doCheck(); }, [doCheck]);

  // Personal data kept on the device for a limited time only (once a day, also offline)
  useEffect(() => {
    void applyDataRetention().catch(() => { /* tried again at the next start */ });
  }, []);

  useEffect(() => {
    void doCheck();
    const onOnline = () => { void doCheck(); };
    const onOffline = () => {
      setSyncEngineOnline(false);
      setSessionRenewal(false);
      setStatus('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    pingTimerRef.current = setInterval(() => { void doCheck(); }, PING_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, [doCheck]);

  const bannerLabel = syncBannerLabel({ status, syncing, pendingCount, lastSyncError, lastSyncedAt });

  return (
    <ConnectionContext.Provider value={{
      status,
      syncing,
      pendingCount,
      lastSyncedAt,
      lastSyncError,
      bannerLabel,
      setSyncing,
      setPendingCount,
      setLastSyncedAt,
      setLastSyncError,
      recheck,
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  return useContext(ConnectionContext);
}
