import type { SessionRecord } from './db';
import { createCredentialStore, OFFLINE_LOGIN_MAX_AGE_DAYS, type OfflineCheck as GenericCheck } from '@/services/offline/credentialStore';

/**
 * Offline login for the guichet (salted PBKDF2, one entry per account): see
 * services/offline/credentialStore.ts. Same storage key as before, so the logins already saved on
 * the devices stay valid.
 */

export { OFFLINE_LOGIN_MAX_AGE_DAYS };

type StoredSession = Omit<SessionRecord, 'id' | 'login_at' | 'offline' | 'password_hash'>;

export type OfflineCheck = GenericCheck<StoredSession>;

const store = createCredentialStore<StoredSession>('sbta_pos_offline_logins');

/** Saves (or refreshes) the offline login of an account after a successful online login. */
export async function saveOfflineLogin(email: string, password: string, session: SessionRecord): Promise<void> {
  const { id: _id, login_at: _at, offline: _off, password_hash: _ph, ...stored } = session;
  void _id; void _at; void _off; void _ph;
  await store.save(email, password, stored);
}

/** Removes the offline login of an account (e.g. the server rejected its password). */
export function forgetOfflineLogin(email: string): void {
  store.forget(email);
}

/** Verifies an email/password against the offline logins saved on this device. */
export function checkOfflineLogin(email: string, password: string): Promise<OfflineCheck> {
  return store.check(email, password);
}
