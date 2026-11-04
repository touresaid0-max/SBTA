/**
 * Identifiers made on the device, used as they are as primary keys on the server (uuid columns).
 *
 * crypto.randomUUID only exists on a secure page (HTTPS or localhost). The guichet used to fall
 * back to `${Date.now()}-${random}`, which is not a UUID: the database refused the row, and the
 * sale stayed in the sending queue for good. Some screens called crypto.randomUUID with no
 * fallback at all and failed outright. (Audit m1.)
 *
 * The fallback is a standard UUID v4 (RFC 9562) built from crypto.getRandomValues, which works on
 * any page; Math.random is only the last resort of a browser without Web Crypto.
 */
export function uuidV4(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Same check as the database's uuid type (any version), for tests and guards. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
