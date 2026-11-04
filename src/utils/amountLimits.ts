/**
 * Amounts typed at the counter (audit m5): a typing slip (one zero too many: 1 000 000 FCFA for
 * a 10 000 FCFA expense) went through and distorted the till and the reports.
 *
 * Each kind of amount has:
 * - max: above it the amount is refused (no ticket, baggage or expense of a coach company
 *   reaches it);
 * - confirmAbove: above it the guichetier is asked to confirm (possible, but unusual).
 *
 * These are default values in FCFA, to adjust here to the company's real prices.
 */
import { formatCurrency } from './formatCurrency';

export interface AmountRule {
  /** Name of the amount in the messages, e.g. « le prix du ticket » */
  label: string;
  max: number;
  confirmAbove: number;
}

export const AMOUNT_RULES = {
  ticketPrice: { label: 'le prix du ticket', max: 150_000, confirmAbove: 30_000 },
  baggagePrice: { label: 'le prix du bagage', max: 200_000, confirmAbove: 25_000 },
  expense: { label: 'la dépense', max: 2_000_000, confirmAbove: 200_000 },
  convoyAmount: { label: 'le montant du convoi', max: 20_000_000, confirmAbove: 2_000_000 },
  convoyCharge: { label: 'la charge du convoi', max: 2_000_000, confirmAbove: 200_000 },
  ramassageAmount: { label: 'le montant du ramassage', max: 5_000_000, confirmAbove: 500_000 },
  parcelFee: { label: 'les frais d\'envoi du courrier', max: 500_000, confirmAbove: 25_000 },
  declaredValue: { label: 'la valeur déclarée du courrier', max: 100_000_000, confirmAbove: 5_000_000 },
} as const satisfies Record<string, AmountRule>;

export interface AmountCheck {
  value: number;
  rule: AmountRule;
  /** Detail added to the label, e.g. « Carburant » for one expense among several */
  detail?: string;
}

function name(item: AmountCheck): string {
  return item.detail ? `${item.rule.label} (${item.detail})` : item.rule.label;
}

/** Error for the first amount that is negative or above its maximum, or null. */
export function amountLimitError(items: AmountCheck[]): string | null {
  for (const item of items) {
    if (!Number.isFinite(item.value)) return `Montant invalide pour ${name(item)}.`;
    if (item.value < 0) return `Montant négatif refusé pour ${name(item)}.`;
    if (item.value > item.rule.max) {
      return `Montant trop élevé pour ${name(item)} : ${formatCurrency(item.value)} (maximum ${formatCurrency(item.rule.max)}). Vérifiez la saisie.`;
    }
  }
  return null;
}

/** Amounts above their usual level (shown in the confirmation). */
export function unusualAmounts(items: AmountCheck[]): AmountCheck[] {
  return items.filter(i => Number.isFinite(i.value) && i.value > i.rule.confirmAbove);
}

/**
 * Asks the guichetier to confirm unusual amounts; true when there is none or when confirmed.
 * `confirmFn` is the browser's confirmation dialog by default (replaceable in tests).
 */
export function confirmUnusualAmounts(items: AmountCheck[], confirmFn: (message: string) => boolean = msg => window.confirm(msg)): boolean {
  const unusual = unusualAmounts(items);
  if (unusual.length === 0) return true;
  const lines = unusual.map(i => `• ${name(i)} : ${formatCurrency(i.value)}`).join('\n');
  return confirmFn(`Montant inhabituel :\n${lines}\n\nConfirmez-vous ce montant ?`);
}

/**
 * Full check before saving: refused above the maximum (the error is returned), then confirmation
 * of unusual amounts. Returns { ok: false } without error when the guichetier cancels.
 */
export function checkAmounts(items: AmountCheck[], confirmFn?: (message: string) => boolean): { ok: boolean; error?: string } {
  const error = amountLimitError(items);
  if (error) return { ok: false, error };
  return { ok: confirmUnusualAmounts(items, confirmFn) };
}
