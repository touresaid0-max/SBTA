import { useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

const HEARTBEAT_INTERVAL = 60_000; // 60 seconds

export function usePresenceHeartbeat() {
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const sendHeartbeat = () => {
      supabase
        .from('users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, [isAuthenticated, user?.id]);
}
