import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase, pingServer, setSessionRenewal } from '@/services/supabase';
import { syncBannerLabel } from '@/components/shared/SyncStatusBanner';
import { setOnline as setSyncEngineOnline } from './syncEngine';
import { requestPersistentStorage } from './persistentStorage';
import { applyDataRetention } from '@/services/offline/dataRetention';
import { preloadPrintLogos } from './printLogos';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Server reachable but no valid login: nothing can be sent, drivers and fares cannot be read */
  sessionExpired: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  bannerLabel: string;
  /** The app is kept on the device for working offline (false while it downloads) */
  offlineReady: boolean;
  setSyncing: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (iso: string) => void;
  setLastSyncError: (message: string | null) => void;
  recheck: () => void;
  /** Pending operations window, kept here: several screens re-create the banner while loading */
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
}

const ConnectionContext = createContext<ConnectionState>({
  status: 'checking',
  sessionExpired: false,
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  lastSyncError: null,
  bannerLabel: '',
  offlineReady: true,
  setSyncing: () => {},
  setPendingCount: () => {},
  setLastSyncedAt: () => {},
  setLastSyncError: () => {},
  recheck: () => {},
  queueOpen: false,
  setQueueOpen: () => {},
});

const PING_INTERVAL_MS = 15_000;

/**
 * The ping below reads the stations, which the database also lets anonymous visitors read: it
 * only tells whether the server answers. Whether the login is still valid is checked apart.
 * getSession() reads the session kept on the device and renews an expired token when it can.
 */
async function hasValidServerSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session) return false;
    return !session.expires_at || session.expires_at * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** Without the login session: offline, a check through the client waited for its renewal (see pingServer). */
async function pingSupabase(): Promise<boolean> {
  return pingServer();
}

export function ConnectionProvider({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The guichet works without network only once the service worker has downloaded the app
  // (about 8 MB, the first time): until then, the network must stay on
  const [offlineReady, setOfflineReady] = useState(
    () => typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
  );

  // The sales not yet sent live in the browser: ask it not to erase them when the disk is full
  useEffect(() => {
    void requestPersistentStorage();
    // Personal data kept on the device for a limited time only (once a day, also offline)
    void applyDataRetention().catch(() => { /* tried again at the next start */ });
  }, []);

  // Logos of the tickets and bordereaux kept on the device, for printing without network
  useEffect(() => {
    if (status === 'online') void preloadPrintLogos();
  }, [status]);

  useEffect(() => {
    if (offlineReady || !('serviceWorker' in navigator)) return;
    const onReady = () => { if (navigator.serviceWorker.controller) setOfflineReady(true); };
    navigator.serviceWorker.addEventListener('controllerchange', onReady);
    void navigator.serviceWorker.ready.then(onReady);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onReady);
  }, [offlineReady]);

  const doCheck = useCallback(async () => {
    const reachable = await pingSupabase();
    setSyncEngineOnline(reachable);
    setSessionRenewal(reachable);
    setStatus(reachable ? 'online' : 'offline');
    // Offline, the session cannot be renewed anyway: only judged when the server answers
    setSessionExpired(reachable ? !(await hasValidServerSession()) : false);
    return reachable;
  }, []);

  const recheck = useCallback(() => { void doCheck(); }, [doCheck]);

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

  const bannerLabel = syncBannerLabel({ status, sessionExpired, syncing, pendingCount, lastSyncError, lastSyncedAt, offlineReady });

  return (
    <ConnectionContext.Provider value={{
      status,
      sessionExpired,
      syncing,
      pendingCount,
      lastSyncedAt,
      lastSyncError,
      bannerLabel,
      offlineReady,
      setSyncing,
      setPendingCount,
      setLastSyncedAt,
      setLastSyncError,
      recheck,
      queueOpen,
      setQueueOpen,
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  return useContext(ConnectionContext);
}
