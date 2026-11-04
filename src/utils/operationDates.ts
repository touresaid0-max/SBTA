/**
 * Dates of operations entered at the counter (audit M10): an expense dated last year or next
 * week was accepted. The device keeps its departures PURGE_DAYS days (services/offline/
 * dataRetention.ts): an expense is entered within that window, and never in the future.
 * The database applies a wider window (migration 20261104120000_phone_amount_checks.sql), for
 * operations that waited in a sending queue.
 */
import { PURGE_DAYS } from '@/services/offline/dataRetention';
import { trustedNowIso } from '@/services/offline/deviceClock';

export const EXPENSE_MAX_PAST_DAYS = PURGE_DAYS;

function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest and latest dates accepted for an expense (YYYY-MM-DD). */
export function expenseDateBounds(): { min: string; max: string } {
  const today = trustedNowIso().slice(0, 10);
  return { min: shiftDays(today, -EXPENSE_MAX_PAST_DAYS), max: today };
}

/** Error to show for an expense date, or null when it is acceptable. */
export function expenseDateError(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Saisissez la date de la dépense.';
  const { min, max } = expenseDateBounds();
  if (date > max) return 'La date de la dépense ne peut pas être dans le futur.';
  if (date < min) return `La date de la dépense ne peut pas remonter à plus de ${EXPENSE_MAX_PAST_DAYS} jours.`;
  return null;
}
