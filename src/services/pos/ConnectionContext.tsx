import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase, setResponseTimeout } from '@/services/supabase';
import { setOnline as setSyncEngineOnline } from './syncEngine';

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
  setSyncing: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (iso: string) => void;
  setLastSyncError: (message: string | null) => void;
  recheck: () => void;
}

const ConnectionContext = createContext<ConnectionState>({
  status: 'checking',
  sessionExpired: false,
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
const GUICHET_RESPONSE_TIMEOUT_MS = 15_000;

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

async function pingSupabase(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('stations')
      .select('id')
      .limit(1)
      .maybeSingle();
    return !error;
  } catch {
    return false;
  }
}

export function ConnectionProvider({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The guichet works without network only once the service worker has downloaded the app
  // (about 8 MB, the first time): until then, the network must stay on
  const [offlineReady, setOfflineReady] = useState(
    () => typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller,
  );

  // While the guichet is open, a request the server does not start answering within this delay
  // fails: the sale is then kept in the queue and the screen uses the copy kept on the device
  useEffect(() => {
    setResponseTimeout(GUICHET_RESPONSE_TIMEOUT_MS);
    return () => setResponseTimeout(null);
  }, []);

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

  const bannerLabel = (() => {
    if (status === 'checking') return 'Vérification de la connexion…';
    if (syncing) return 'Synchronisation en cours…';
    if (status === 'offline') {
      if (pendingCount > 0) return `Hors ligne — ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente de synchronisation`;
      return 'Hors ligne — fonctionnement local';
    }
    if (sessionExpired) {
      return pendingCount > 0
        ? `En ligne — session expirée : ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente, déconnectez-vous puis reconnectez-vous`
        : 'En ligne — session expirée : déconnectez-vous puis reconnectez-vous';
    }
    if (lastSyncError) return `En ligne — synchronisation à reprendre : ${lastSyncError}`;
    if (pendingCount > 0) return `En ligne — ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente`;
    if (!offlineReady) return 'En ligne — préparation du mode hors ligne, gardez la connexion';
    if (lastSyncedAt) return 'En ligne — Synchronisé';
    return 'En ligne';
  })();

  return (
    <ConnectionContext.Provider value={{
      status,
      sessionExpired,
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
