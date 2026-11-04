// The guichet dated its sales, expenses, closings and parcels with the device's clock: a device
// set to the wrong day or hour (or set back on purpose) gave wrong dates to the sales, the till
// reports and the departures still open for sale, and nothing showed it.
// The gap between the device's clock and the server's is now measured each time the device is
// online, and kept on the device: what is recorded (online or offline) is dated with the device's
// clock corrected by that gap. A gap of more than CLOCK_ALERT_MS is shown to the guichetier.
// Waits and timeouts of the sending queue keep the device's clock: they only measure durations.

const STORAGE_KEY = 'sbta_server_clock';
/** Gap shown to the guichetier above this */
export const CLOCK_ALERT_MS = 5 * 60_000;
/** Answers slower than this give an imprecise time: not used */
const MAX_ROUND_TRIP_MS = 5_000;

interface ClockGap {
  /** Server time minus device time, in ms */
  offset_ms: number;
  /** When it was measured (server time) */
  measured_at: string;
}

function readGap(): ClockGap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const gap = raw ? JSON.parse(raw) as ClockGap : null;
    return gap && Number.isFinite(gap.offset_ms) ? gap : null;
  } catch {
    return null;
  }
}

let gap: ClockGap | null = readGap();

/** Server time minus device time (0 while never measured). */
export function clockOffsetMs(): number {
  return gap?.offset_ms ?? 0;
}

/** Current time, corrected by the gap measured with the server. */
export function trustedNow(): Date {
  return new Date(Date.now() + clockOffsetMs());
}

export function trustedNowIso(): string {
  return trustedNow().toISOString();
}

/**
 * Measures the gap with the server's clock (function get_server_time) and keeps it on the device.
 * Returns the gap in ms, or null when the server could not be asked (the last gap is kept).
 */
export async function syncServerClock(): Promise<number | null> {
  try {
    // Loaded here only: the ticket and slip builders use this module and stay free of the server client
    const { supabase } = await import('@/services/supabase');
    const before = Date.now();
    const { data, error } = await supabase.rpc('get_server_time');
    const after = Date.now();
    if (error || !data) return null;
    const serverMs = new Date(String(data)).getTime();
    if (!Number.isFinite(serverMs) || after - before > MAX_ROUND_TRIP_MS) return null;
    const offset = Math.round(serverMs + (after - before) / 2 - after);
    gap = { offset_ms: offset, measured_at: new Date(after + offset).toISOString() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gap)); } catch { /* kept for this page only */ }
    return offset;
  } catch {
    return null;
  }
}

function minutes(ms: number): string {
  const total = Math.round(Math.abs(ms) / 60_000);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} jours`;
}

/** Message for the guichetier when the device's clock is off by more than CLOCK_ALERT_MS. */
export function clockWarning(): string | null {
  const offset = clockOffsetMs();
  if (Math.abs(offset) <= CLOCK_ALERT_MS) return null;
  // offset > 0: the server is ahead, so the device is late
  const way = offset > 0 ? 'retarde' : 'avance';
  return `L'horloge de ce poste ${way} de ${minutes(offset)} : les opérations sont datées à l'heure du serveur. Faites régler la date et l'heure du poste.`;
}

/** For tests: forget the measured gap. */
export function resetServerClock(): void {
  gap = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing kept */ }
}
