import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/services/supabase';
import { setOnline as setSyncEngineOnline } from './syncEngine';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

export interface ConnectionState {
  status: ConnectionStatus;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  bannerLabel: string;
  setSyncing: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (iso: string) => void;
  recheck: () => void;
}

const ConnectionContext = createContext<ConnectionState>({
  status: 'checking',
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  bannerLabel: '',
  setSyncing: () => {},
  setPendingCount: () => {},
  setLastSyncedAt: () => {},
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
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastOnlineRef = useRef<boolean>(true);

  const doCheck = useCallback(async () => {
    const reachable = await pingSupabase();
    setSyncEngineOnline(reachable);
    const next: ConnectionStatus = reachable ? 'online' : 'offline';
    setStatus(prev => {
      if (prev === next) return prev;
      if (prev === 'offline' && next === 'online') {
        lastOnlineRef.current = true;
      }
      if (prev === 'online' && next === 'offline') {
        lastOnlineRef.current = false;
      }
      return next;
    });
    return reachable;
  }, []);

  const recheck = useCallback(() => { void doCheck(); }, [doCheck]);

  useEffect(() => {
    void doCheck();

    const onOnline = () => { void doCheck(); };
    const onOffline = () => { setSyncEngineOnline(false); setStatus('offline'); };
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
    if (status === 'offline') {
      if (pendingCount > 0) return `Hors ligne — ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente de synchronisation`;
      return 'Hors ligne — fonctionnement local';
    }
    if (syncing) return 'Synchronisation en cours…';
    if (pendingCount > 0) return `En ligne — ${pendingCount} opération${pendingCount > 1 ? 's' : ''} en attente`;
    if (lastSyncedAt) return 'En ligne — Synchronisé';
    return 'En ligne';
  })();

  return (
    <ConnectionContext.Provider value={{
      status, syncing, pendingCount, lastSyncedAt, bannerLabel,
      setSyncing, setPendingCount, setLastSyncedAt, recheck,
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  return useContext(ConnectionContext);
}
