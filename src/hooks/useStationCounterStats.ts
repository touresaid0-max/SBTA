import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

export interface CounterStatRow {
  counter_id: string;
  counter_number: number | null;
  guichetier_name: string | null;
  departures: number;
  tickets: number;
  seats_remaining: number;
  ticket_amount: number;
  charges: number;
  solde: number;
}

export interface CounterStatsResult {
  rows: CounterStatRow[];
  totals: {
    departures: number;
    tickets: number;
    seats_remaining: number;
    ticket_amount: number;
    charges: number;
    solde: number;
  };
  loading: boolean;
  refresh: () => void;
}

const POLL_INTERVAL = 15_000;

export function useStationCounterStats(targetDate: string, stationId?: string | null): CounterStatsResult {
  const { user } = useAuthStore();
  const [rows, setRows] = useState<CounterStatRow[]>([]);
  const [totals, setTotals] = useState({
    departures: 0, tickets: 0, seats_remaining: 0,
    ticket_amount: 0, charges: 0, solde: 0,
  });
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      let sid = stationId ?? null;
      if (!sid) {
        const { data } = await supabase.rpc('get_my_station_id');
        sid = data as string | null;
      }
      if (!sid) return;

      const { count: chefCount } = await supabase
        .from('station_managers')
        .select('id', { count: 'exact', head: true })
        .eq('station_id', sid);
      const restrictManagerId = (chefCount ?? 0) > 1 ? user?.id ?? null : null;

      let countersQuery = supabase
        .from('counters')
        .select('id, counter_number, is_active, assigned_user_id, assigned_user:assigned_user_id(full_name)')
        .eq('station_id', sid)
        .order('counter_number');
      if (restrictManagerId) countersQuery = countersQuery.eq('manager_id', restrictManagerId);

      const { data: countersData } = await countersQuery;
      const counterMap: Record<string, CounterStatRow> = {};

      (countersData || []).forEach((c: any) => {
        counterMap[c.id] = {
          counter_id: c.id,
          counter_number: c.counter_number,
          guichetier_name: (c.assigned_user as any)?.full_name ?? null,
          departures: 0, tickets: 0, seats_remaining: 0,
          ticket_amount: 0, charges: 0, solde: 0,
        };
      });

      let summaryQuery = supabase
        .from('schedule_receipt_summary')
        .select('counter_id, bus_id, seats_sold, seats_remaining, total_ticket_amount, total_charges, solde_ticket')
        .eq('station_id', sid)
        .eq('departure_date', targetDate);

      if (restrictManagerId) {
        const visibleIds = (countersData || []).map((c: any) => c.id);
        if (visibleIds.length === 0) {
          setRows([]); setTotals({ departures: 0, tickets: 0, seats_remaining: 0, ticket_amount: 0, charges: 0, solde: 0 });
          return;
        }
        summaryQuery = summaryQuery.in('counter_id', visibleIds);
      }

      const { data: summaryRows } = await summaryQuery;

      const seenBusPerCounter: Record<string, Set<string>> = {};
      const globalSeenBuses = new Map<string, number>();

      (summaryRows || []).forEach((r: any) => {
        const key = r.counter_id;
        if (key && counterMap[key]) {
          counterMap[key].departures += 1;
          counterMap[key].tickets += r.seats_sold || 0;
          counterMap[key].ticket_amount += r.total_ticket_amount || 0;
          counterMap[key].charges += r.total_charges || 0;
          counterMap[key].solde += r.solde_ticket || 0;

          if (!seenBusPerCounter[key]) seenBusPerCounter[key] = new Set();
          const busId = r.bus_id;
          if (busId && !seenBusPerCounter[key].has(busId)) {
            seenBusPerCounter[key].add(busId);
            counterMap[key].seats_remaining += r.seats_remaining || 0;
          }
          if (busId && !globalSeenBuses.has(busId)) {
            globalSeenBuses.set(busId, r.seats_remaining || 0);
          }
        }
      });

      const sorted = Object.values(counterMap).sort((a, b) => {
        if (a.counter_number == null) return 1;
        if (b.counter_number == null) return -1;
        return a.counter_number - b.counter_number;
      });

      setRows(sorted);
      setTotals({
        departures: sorted.reduce((s, r) => s + r.departures, 0),
        tickets: sorted.reduce((s, r) => s + r.tickets, 0),
        seats_remaining: Array.from(globalSeenBuses.values()).reduce((s, v) => s + v, 0),
        ticket_amount: sorted.reduce((s, r) => s + r.ticket_amount, 0),
        charges: sorted.reduce((s, r) => s + r.charges, 0),
        solde: sorted.reduce((s, r) => s + r.solde, 0),
      });
    } catch {
      // silent — will retry on next poll
    } finally {
      setLoading(false);
    }
  }, [targetDate, stationId, user?.id]);

  useEffect(() => {
    setLoading(true);
    load();
    timerRef.current = setInterval(load, POLL_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  return { rows, totals, loading, refresh: load };
}
