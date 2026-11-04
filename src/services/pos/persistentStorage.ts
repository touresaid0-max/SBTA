// The guichet keeps its sales, departures and queue of operations not yet sent in the browser
// (IndexedDB). By default the browser may erase that data when the disk is nearly full. Asking
// for persistent storage prevents it. Chrome grants it without asking the user, notably when the
// guichet is installed as an application; Firefox asks the user.

export interface StorageStatus {
  /** null: the browser cannot say (old browser) */
  persisted: boolean | null;
  usageBytes?: number;
  quotaBytes?: number;
}

/** Asks once for persistent storage. Returns whether the data is protected (null: unknown). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
    return { persisted, usageBytes: estimate?.usage, quotaBytes: estimate?.quota };
  } catch {
    return { persisted: null };
  }
}

// ── Quota of the device's storage (audit m7) ──
// The space used was shown in Paramètres but nobody looked at it. When the browser's quota is
// nearly reached, new sales can no longer be saved on the device (« QuotaExceededError ») and
// the browser may erase the guichet's data. The level is now checked and shown to the guichetier.

export type StorageLevel = 'ok' | 'warning' | 'critical' | 'unknown';

/** Share of the quota from which the guichetier is warned, then urged to free space. */
export const STORAGE_WARNING_RATIO = 0.8;
export const STORAGE_CRITICAL_RATIO = 0.95;

export function storageLevel(status: StorageStatus): { level: StorageLevel; ratio: number | null } {
  if (!status.usageBytes || !status.quotaBytes) return { level: 'unknown', ratio: null };
  const ratio = status.usageBytes / status.quotaBytes;
  if (ratio >= STORAGE_CRITICAL_RATIO) return { level: 'critical', ratio };
  if (ratio >= STORAGE_WARNING_RATIO) return { level: 'warning', ratio };
  return { level: 'ok', ratio };
}

export function formatMegabytes(bytes: number | undefined): string {
  return `${((bytes ?? 0) / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}
