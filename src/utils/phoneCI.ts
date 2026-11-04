/**
 * Côte d'Ivoire phone numbers (audit M10).
 *
 * Since 31 January 2021 they have 10 digits: mobiles start with 01 (Moov), 05 (MTN) or 07
 * (Orange), fixed lines with 21, 25 or 27; the country code is +225. Five of the six phone fields
 * of the guichet accepted any text; they now all follow this rule.
 *
 * Forms keep the 10 national digits; the database receives one single form: 225 + 10 digits
 * (what the SMS service already expected). The same rule is enforced by the database
 * (migration 20261104120000_phone_amount_checks.sql).
 */

/** 10 national digits, starting with a valid prefix. */
export const PHONE_CI_REGEX = /^(01|05|07|21|25|27)\d{8}$/;

/** Stored form: 225 followed by a valid national number. */
export const STORED_PHONE_CI_REGEX = /^225(01|05|07|21|25|27)\d{8}$/;

/**
 * Keeps the national digits of what was typed or pasted: spaces, dots, dashes and the country
 * code (+225, 00225, or 225 in front of 10 digits) are removed, and the result stops at 10 digits.
 */
export function normalizePhoneCI(input: string | null | undefined): string {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.startsWith('00225')) digits = digits.slice(5);
  else if (digits.startsWith('225') && digits.length >= 13) digits = digits.slice(3);
  return digits.slice(0, 10);
}

export function isValidPhoneCI(national: string): boolean {
  return PHONE_CI_REGEX.test(national);
}

/** Error to show for a phone field, or null when it is acceptable. */
export function phoneCIError(national: string, required: boolean): string | null {
  if (!national) return required ? 'Saisissez le numéro de téléphone.' : null;
  if (national.length < 10) return `Numéro incomplet : ${national.length} chiffre${national.length > 1 ? 's' : ''} sur 10.`;
  if (!isValidPhoneCI(national)) return 'Le numéro doit commencer par 01, 05, 07, 21, 25 ou 27.';
  return null;
}

/** Form stored in the database: '225' + 10 digits ('' when empty). */
export function toStoredPhoneCI(national: string): string {
  return national ? `225${national}` : '';
}

/**
 * For data sent to the server (sending queue): the stored form when the value is a valid number,
 * '' otherwise. Operations saved by earlier versions (free text) then pass the database rule
 * instead of being refused for good; an invalid number could not be used anyway.
 */
export function storedPhoneOrEmpty(value: unknown): string {
  const national = normalizePhoneCI(typeof value === 'string' ? value : '');
  return isValidPhoneCI(national) ? `225${national}` : '';
}

/** Display by pairs: 07 59 81 81 55 (accepts the stored form too). */
export function formatPhoneCI(value: string | null | undefined): string {
  const national = normalizePhoneCI(value);
  return national.replace(/(\d{2})(?=\d)/g, '$1 ');
}
