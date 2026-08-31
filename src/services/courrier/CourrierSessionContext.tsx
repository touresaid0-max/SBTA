import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getCurrentSession, logoutCourrier, type CourrierLoginResult } from './offlineAuth';
import type { SessionRecord } from './db';

interface CourrierSessionContextValue {
  session: SessionRecord | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const CourrierSessionContext = createContext<CourrierSessionContextValue>({
  session: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function CourrierSessionProvider({ children }: { children?: ReactNode }) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await getCurrentSession();
    setSession(s ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await logoutCourrier();
    setSession(null);
  }, []);

  return (
    <CourrierSessionContext.Provider value={{ session, loading, refresh, logout }}>
      {children}
    </CourrierSessionContext.Provider>
  );
}

export function useCourrierSession() {
  return useContext(CourrierSessionContext);
}

export type { CourrierLoginResult };
