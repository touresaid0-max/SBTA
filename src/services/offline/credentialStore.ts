/**
 * Offline login (audit M8): after one successful online login, an account can sign in again
 * without network on the same device. One entry per account (several people can share a device),
 * kept after logout, valid OFFLINE_LOGIN_MAX_AGE_DAYS after the last online login.
 *
 * The password itself is never stored: only a PBKDF2 hash with a random salt per account, so that
 * a copy of the device's storage cannot be checked against a dictionary at the speed of a plain
 * SHA-256 (the courrier and older guichet versions kept such an unsalted SHA-256).
 *
 * Shared by the guichet and the courrier, each with its own storage key.
 */

const PBKDF2_ITERATIONS = 150_000;
export const OFFLINE_LOGIN_MAX_AGE_DAYS = 30;

interface OfflineLogin<S> {
  salt: string;
  hash: string;
  iterations: number;
  saved_at: string;
  session: S;
}

export type OfflineCheck<S> =
  | { status: 'ok'; session: S }
  | { status: 'unknown' }
  | { status: 'expired' }
  | { status: 'wrong_password' };

const normalize = (email: string) => email.trim().toLowerCase();

const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return toHex(new Uint8Array(bits));
}

/** Same result whatever the position of the first different character. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CredentialStore<S> {
  /** Saves (or refreshes) the offline login of an account after a successful online login. */
  save(email: string, password: string, session: S): Promise<void>;
  /** Removes the offline login of an account (e.g. the server rejected its password). */
  forget(email: string): void;
  /** Verifies an email/password against the offline logins saved on this device. */
  check(email: string, password: string): Promise<OfflineCheck<S>>;
}

export function createCredentialStore<S>(storageKey: string): CredentialStore<S> {
  const readAll = (): Record<string, OfflineLogin<S>> => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, OfflineLogin<S>>;
    } catch {
      return {};
    }
  };

  const writeAll = (all: Record<string, OfflineLogin<S>>): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {
      // storage unavailable or full: offline login simply won't be possible
    }
  };

  return {
    async save(email, password, session) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derive(password, salt, PBKDF2_ITERATIONS);
      const all = readAll();
      all[normalize(email)] = {
        salt: toHex(salt),
        hash,
        iterations: PBKDF2_ITERATIONS,
        saved_at: new Date().toISOString(),
        session,
      };
      writeAll(all);
    },

    forget(email) {
      const all = readAll();
      if (all[normalize(email)]) {
        delete all[normalize(email)];
        writeAll(all);
      }
    },

    async check(email, password) {
      const entry = readAll()[normalize(email)];
      if (!entry || !entry.salt || !entry.hash) return { status: 'unknown' };

      const ageDays = (Date.now() - new Date(entry.saved_at).getTime()) / 86_400_000;
      if (!(ageDays <= OFFLINE_LOGIN_MAX_AGE_DAYS)) return { status: 'expired' };

      const hash = await derive(password, fromHex(entry.salt), entry.iterations || PBKDF2_ITERATIONS);
      if (!sameHash(hash, entry.hash)) return { status: 'wrong_password' };
      return { status: 'ok', session: entry.session };
    },
  };
}
