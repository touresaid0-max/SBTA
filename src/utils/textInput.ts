/**
 * Free text typed at the counter (audit m2): names, descriptions, labels, remarks.
 *
 * Nothing was cleaned or limited: spaces before and after, doubled spaces, invisible control
 * characters (from a paste) and texts of any length reached the database and the 58/80 mm
 * thermal tickets, where a long text broke the layout.
 *
 * Fields get a maxLength from TEXT_LIMITS; values are cleaned when they are saved.
 */

/** Longest text accepted per kind of field (characters). */
export const TEXT_LIMITS = {
  /** Person's name (sender, recipient, owner, customer) */
  name: 80,
  /** Short label (expense label) */
  label: 100,
  /** City name */
  city: 60,
  /** Description (baggage, parcel content, expense) */
  description: 200,
  /** Remark on several lines (convoy observation) */
  note: 300,
  /** Identity document number */
  idNumber: 30,
} as const;

// Control characters (tab, line breaks, other C0/C1 controls): replaced by a space
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

// Invisible characters from a paste (zero-width, direction marks, byte order mark): removed,
// so that "Ya\u200Bo" gives "Yao" and not "Ya o"
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * One-line text as saved: invisible characters removed, spaces collapsed, trimmed, and cut at
 * `max` characters when given.
 */
export function cleanText(value: string | null | undefined, max?: number): string {
  const cleaned = String(value ?? '')
    .replace(INVISIBLE_CHARS, '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return max ? cleaned.slice(0, max).trim() : cleaned;
}

/**
 * Text on several lines as saved: each line cleaned like cleanText, at most one empty line in a
 * row, trimmed, and cut at `max` characters when given.
 */
export function cleanMultiline(value: string | null | undefined, max?: number): string {
  const cleaned = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(INVISIBLE_CHARS, '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return max ? cleaned.slice(0, max).trim() : cleaned;
}
