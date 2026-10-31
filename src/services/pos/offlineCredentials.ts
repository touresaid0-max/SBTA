import type { SessionRecord } from './db';

/**
 * Offline login for the guichet: after one successful online login, the guichetier can sign in
 * again without network on the same device. One entry per account (several guichetiers can share
 * a device), kept after logout, valid OFFLINE_LOGIN_MAX_AGE_DAYS after the last online login.
 * The password itself is never stored: only a salted PBKDF2 hash.
 */

const STORAGE_KEY = 'sbta_pos_offline_logins';
const PBKDF2_ITERATIONS = 150_000;
export const OFFLINE_LOGIN_MAX_AGE_DAYS = 30;

type StoredSession = Omit<SessionRecord, 'id' | 'login_at' | 'offline' | 'password_hash'>;

interface OfflineLogin {
  salt: string;
  hash: string;
  iterations: number;
  saved_at: string;
  session: StoredSession;
}

const normalize = (email: string) => email.trim().toLowerCase();

const toHex = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return toHex(new Uint8Array(bits));
}

function readAll(): Record<string, OfflineLogin> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, OfflineLogin>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, OfflineLogin>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable or full: offline login simply won't be possible
  }
}

/** Saves (or refreshes) the offline login of an account after a successful online login. */
export async function saveOfflineLogin(email: string, password: string, session: SessionRecord): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  const { id: _id, login_at: _at, offline: _off, password_hash: _ph, ...stored } = session;
  const all = readAll();
  all[normalize(email)] = {
    salt: toHex(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
    saved_at: new Date().toISOString(),
    session: stored,
  };
  writeAll(all);
}

/** Removes the offline login of an account (e.g. the server rejected its password). */
export function forgetOfflineLogin(email: string): void {
  const all = readAll();
  if (all[normalize(email)]) {
    delete all[normalize(email)];
    writeAll(all);
  }
}

export type OfflineCheck =
  | { status: 'ok'; session: StoredSession }
  | { status: 'unknown' }
  | { status: 'expired' }
  | { status: 'wrong_password' };

/** Verifies an email/password against the offline logins saved on this device. */
export async function checkOfflineLogin(email: string, password: string): Promise<OfflineCheck> {
  const entry = readAll()[normalize(email)];
  if (!entry) return { status: 'unknown' };

  const ageDays = (Date.now() - new Date(entry.saved_at).getTime()) / 86_400_000;
  if (!(ageDays <= OFFLINE_LOGIN_MAX_AGE_DAYS)) return { status: 'expired' };

  const hash = await derive(password, fromHex(entry.salt), entry.iterations);
  if (hash !== entry.hash) return { status: 'wrong_password' };
  return { status: 'ok', session: entry.session };
}
