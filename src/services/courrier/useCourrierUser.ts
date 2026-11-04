import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getReferentiel } from './referentiels';

export interface CourrierUser {
  id: string | null;
  full_name: string;
  phone: string | null;
  station_id: string | null;
  station_name: string;
  station_phone: string;
  /** Directions the agent may handle (sortant / entrant); null = both */
  colis_direction: string[] | null;
}

interface StationExtra { id: string; phone?: string | null }

/**
 * The account and station the courrier screens work for.
 *
 * At the guichet, the station is the one of the counter's session (kept on the device and
 * restored by the offline login). The online profile (useAuthStore) is empty after an offline
 * login, and its station can differ from the counter's: without this, the courrier screens had
 * no station without Internet and showed nothing.
 */
export function useCourrierUser(): CourrierUser {
  const { user } = useAuthStore();
  const { session } = usePOSSession();
  const [cachedPhone, setCachedPhone] = useState('');

  const base = useMemo(() => {
    // Profile details are only trusted when they belong to the same account as the session
    const profile = session && user?.id !== session.user_id ? null : user;
    if (session) {
      const sameStation = profile?.station_id === session.station_id;
      return {
        id: session.user_id,
        full_name: session.full_name,
        phone: profile?.phone ?? null,
        station_id: session.station_id || null,
        station_name: session.station_name ?? '',
        station_phone: sameStation ? profile?.station_phone ?? '' : '',
        colis_direction: profile?.colis_direction ?? null,
      };
    }
    return {
      id: user?.id ?? null,
      full_name: user?.full_name ?? '',
      phone: user?.phone ?? null,
      station_id: user?.station_id ?? null,
      station_name: user?.station_name ?? '',
      station_phone: user?.station_phone ?? '',
      colis_direction: user?.colis_direction ?? null,
    };
  }, [session, user]);

  // Station phone (printed on receipts and slips) from the data kept on the device
  useEffect(() => {
    if (base.station_phone || !base.station_id) return;
    let cancelled = false;
    void getReferentiel<StationExtra>('station_extras').then(list => {
      const phone = list?.find(s => s.id === base.station_id)?.phone ?? '';
      if (!cancelled) setCachedPhone(phone ?? '');
    });
    return () => { cancelled = true; };
  }, [base.station_id, base.station_phone]);

  return { ...base, station_phone: base.station_phone || cachedPhone };
}

/** No answer from the server (no network, cut connection, timeout, server down). */
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; status?: number | string; message?: string };
  if (e.name === 'AuthRetryableFetchError' || err instanceof TypeError) return true;
  if (Number(e.status ?? 0) >= 500) return true;
  return /failed to fetch|network|load failed|timeout|délai|fetch/i.test(String(e.message ?? ''));
}
