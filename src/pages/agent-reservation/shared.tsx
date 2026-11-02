import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase';
import { createRefreshScheduler } from '@/utils/realtimeRefresh';

export const STATUS_LABELS: Record<string, string> = {
  provisional: 'Provisoire',
  confirmed: 'Définitif',
  cancelled: 'Annulé',
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  provisional: { bg: '#FEF3C7', text: '#B45309' },
  confirmed: { bg: '#E7F6EC', text: '#0B7439' },
  cancelled: { bg: '#FEE2E2', text: '#B91C1C' },
};

export const PAYMENT_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payé',
  failed: 'Échoué',
  refunded: 'Remboursé',
};

export const PAYMENT_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FEF3C7', text: '#B45309' },
  paid: { bg: '#E7F6EC', text: '#0B7439' },
  failed: { bg: '#FEE2E2', text: '#B91C1C' },
  refunded: { bg: '#DBEAFE', text: '#1D4ED8' },
};

export const USER_STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  suspended: 'Suspendu',
  pending_otp: 'En attente OTP',
  pending_confirmation: 'En attente',
};

export const USER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: '#E7F6EC', text: '#0B7439' },
  inactive: { bg: '#F3F4F6', text: '#6B7280' },
  suspended: { bg: '#FEE2E2', text: '#B91C1C' },
  pending_otp: { bg: '#FEF3C7', text: '#B45309' },
  pending_confirmation: { bg: '#DBEAFE', text: '#1D4ED8' },
};

export function Badge({ map, colors, value }: { map: Record<string, string>; colors: Record<string, { bg: string; text: string }>; value: string }) {
  const c = colors[value] ?? { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ backgroundColor: c.bg, color: c.text }}>
      {map[value] ?? value}
    </span>
  );
}

/** Subscribe to realtime changes on tables; calls onChange at most every 10 s after events. */
export function useRealtimeSync(tables: string[], onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const refresh = createRefreshScheduler(() => onChangeRef.current());
    const channel = supabase.channel('agent-resa-' + tables.join('-'));
    tables.forEach((t) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, refresh.schedule);
    });
    channel.subscribe();
    return () => {
      refresh.cancel();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
