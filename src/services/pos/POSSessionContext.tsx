import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import type { SessionRecord } from './db';
import { getCurrentSession, logoutPOS } from './offlineAuth';

interface POSSessionContextValue {
  session: SessionRecord | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const POSSessionContext = createContext<POSSessionContextValue>({
  session: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function POSSessionProvider({ children }: { children?: ReactNode }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await getCurrentSession();
    setSession(s ?? null);
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    await logoutPOS();
    setSession(null);
  }, [logoutPOS]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <POSSessionContext.Provider value={{ session, loading, refresh, logout }}>
      {children ?? <Outlet />}
    </POSSessionContext.Provider>
  );
}

export function usePOSSession() {
  return useContext(POSSessionContext);
}
