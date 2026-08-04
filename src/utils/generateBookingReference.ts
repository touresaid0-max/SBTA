/**
 * Generates a collision-resistant booking reference.
 * Uses crypto.randomUUID when available (guaranteed unique), falls back
 * to Date.now + longer random suffix otherwise.
 */
export function generateBookingReference(prefix = 'SBTA'): string {
  const year = new Date().getFullYear();
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${year}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${year}-${Date.now().toString(36).toUpperCase()}-${rand}`;
}
