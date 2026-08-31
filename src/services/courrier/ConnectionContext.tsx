import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/services/supabase';
import { setOnline as setSyncEngineOnline } from './syncEngine';

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
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doCheck = useCallback(async () => {
    const reachable = await pingSupabase();
    setSyncEngineOnline(reachable);
    setStatus(reachable ? 'online' : 'offline');
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
    if (lastSyncError) return `En ligne — synchronisation à reprendre : ${lastSyncError}`;
    if (pendingCount > 0) return `En ligne — ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente`;
    if (lastSyncedAt) return 'En ligne — Synchronisé';
    return 'En ligne';
  })();

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
