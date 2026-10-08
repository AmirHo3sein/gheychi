// Persian (U+06F0..) and Arabic-Indic (U+0660..) digits -> ASCII.
const toAsciiDigits = (input: string): string =>
  input.replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf));

/** Iranian mobile (09xxxxxxxxx) or landline (area code 01-08 + 8 digits). */
export const CONTACT_PHONE_PATTERN = /^(09\d{9}|0[1-8]\d{9})$/;

/**
 * Class-transformer step for a salon's public contact phone: '' and null clear it,
 * digits are normalised to ASCII and spaces/dashes stripped. Anything else (including a
 * non-string) is returned untouched so the validators downstream reject it.
 */
export function normalizeContactPhone(value: unknown): unknown {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return value;
  const cleaned = toAsciiDigits(value).replace(/[\s\-‌‏]/g, '');
  return cleaned === '' ? null : cleaned;
}
