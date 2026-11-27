import { supabase } from '@/services/supabase';
import { trustedNow } from '@/services/offline/deviceClock';
import { DEFAULT_LATE_CLOSURE, isDepartureOver, type LateClosureRule } from '@/utils/departureTime';

// Settings of the closing of late departures (closure_settings, set by the administrator): read at
// each sync and kept on the device, so that the rule applies offline too. Without them (never read,
// server without the table), 20h and 5 h.

const STORAGE_KEY = 'sbta_late_closure_rule';

export function lateClosureRule(): LateClosureRule {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<LateClosureRule> | null;
    const fromHour = Number(saved?.fromHour);
    const minHours = Number(saved?.minHours);
    if (Number.isInteger(fromHour) && fromHour >= 0 && fromHour <= 23 && Number.isFinite(minHours) && minHours >= 0 && minHours <= 23) {
      return { fromHour, minHours };
    }
  } catch { /* storage unavailable or unreadable: the default rule */ }
  return DEFAULT_LATE_CLOSURE;
}

// Read again at most every 30 minutes: the guichet syncs often, the settings rarely change
const REFRESH_MS = 30 * 60_000;
let lastRefresh = 0;

/** Reads the settings on the server and keeps them on the device (kept as they were on failure). */
export async function refreshLateClosureRule(): Promise<void> {
  if (Date.now() - lastRefresh < REFRESH_MS) return;
  lastRefresh = Date.now();
  try {
    const { data, error } = await supabase
      .from('closure_settings')
      .select('late_from_hour, late_min_hours')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return;
    const rule = { fromHour: Number(data.late_from_hour), minHours: Number(data.late_min_hours) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rule));
  } catch { /* kept as they were */ }
}

/** The departure can no longer be sold: its day is over (later for a late departure). */
export function isDepartSaleOver(depart: { departure_datetime: string; created_at?: string | null }): boolean {
  return isDepartureOver(depart.departure_datetime, depart.created_at, trustedNow(), lateClosureRule());
}
