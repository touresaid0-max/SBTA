// One formatter for the whole app: building an Intl.NumberFormat at each call was the most costly
// step of the redraws of the sale screen (same output).
const CURRENCY = new Intl.NumberFormat('fr-FR', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat('fr-FR');

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '— FCFA';
  }
  return CURRENCY.format(Number(amount)) + ' FCFA';
}

export function formatNumber(num: number): string {
  return NUMBER.format(num);
}
