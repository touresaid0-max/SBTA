import { setOnline, flushSyncQueue, getPendingCount, recoverUnqueuedRecords } from './syncEngine';
import { syncParcelsFromServer } from './offlineStore';
import { refreshAllReferentiels } from './referentiels';
import { ensureAuthSession } from '@/services/pos/offlineAuth';

// From the guichet's other pages, the parcels are pulled less often than on the courrier screens
const PULL_INTERVAL_MS = 60_000;
const REFERENTIELS_INTERVAL_MS = 10 * 60_000;

let lastPull = 0;
let lastReferentiels = 0;

/**
 * Courrier sync run by the guichet's own sync, on every page (sale, departures, convoys…).
 *
 * Without it, parcels registered without network only left the device when a courrier screen was
 * open, and the parcels to receive were only kept on the device after a visit to those screens.
 * Called only when the guichet's sync has reached the server.
 */
export async function syncCourrierInBackground(stationId: string | undefined, force = false): Promise<void> {
  setOnline(true);
  await recoverUnqueuedRecords().catch(() => { /* tried again at the next sync */ });
  // After a long time offline the session may have expired: renewed first, otherwise the SMS
  // function refused the queued SMS (the guichet only did it when it had sales to send itself)
  if (await getPendingCount() > 0 && await ensureAuthSession()) await flushSyncQueue();

  const now = Date.now();
  if (force || now - lastPull >= PULL_INTERVAL_MS) {
    lastPull = now;
    await syncParcelsFromServer(stationId);
  }
  if (force || now - lastReferentiels >= REFERENTIELS_INTERVAL_MS) {
    lastReferentiels = now;
    await refreshAllReferentiels(stationId);
  }
}

/** The guichet's connection state, shared with the courrier screens. */
export function setCourrierOnline(online: boolean): void {
  setOnline(online);
}
