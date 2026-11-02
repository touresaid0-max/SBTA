// Spare-parts purchase orders, as stored in the database (spare_parts_purchase_orders):
// the lines are kept in the `items` JSON column, the parts come from `spare_parts`.

/** One order line, in the `items` column. */
export interface PurchaseOrderItem {
  part_id?: string;
  part_number: string;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  /** Quantity already received into stock (absent on lines created before receiving) */
  received_quantity?: number;
}

/** Statuses allowed by the database. */
export type PurchaseOrderStatus = 'en_attente' | 'validee' | 'livree' | 'annulee';

export const PURCHASE_ORDER_STATUS: Record<PurchaseOrderStatus, { label: string; color: string; bg: string }> = {
  en_attente: { label: 'Brouillon', color: '#64748B', bg: '#F1F5F9' },
  validee: { label: 'Commandé', color: '#1D6FA4', bg: '#EFF6FF' },
  livree: { label: 'Reçu', color: '#0B7439', bg: '#E8F5E9' },
  annulee: { label: 'Annulé', color: '#AF3029', bg: '#FEF2F2' },
};

export function statusInfo(status: string) {
  return PURCHASE_ORDER_STATUS[status as PurchaseOrderStatus] ?? PURCHASE_ORDER_STATUS.en_attente;
}

export function receivedOf(item: PurchaseOrderItem): number {
  return Number(item.received_quantity ?? 0);
}

/**
 * Placeholder order number: always unique, so the order can be saved. The database replaces it
 * with the next number of the year (BC-AAAA-NNNN): trigger of migration 20261102140000.
 */
export function provisionalOrderNumber(): string {
  const id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `BC-TEMP-${id.toUpperCase()}`;
}
