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
