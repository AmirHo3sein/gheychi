import { randomBytes } from 'crypto';

/**
 * Slugifies `name` and appends a random hex suffix for uniqueness.
 * Falls back to `${fallbackPrefix}-<8-hex>` when the input has no latin/digit
 * characters to slugify (e.g. Persian-only titles), since the stripped base
 * would otherwise be too short (<3 chars) to form a useful slug.
 */
export function makeSlug(name: string, fallbackPrefix = 'salon'): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length < 3) return `${fallbackPrefix}-${randomBytes(4).toString('hex')}`;
  return `${base}-${randomBytes(2).toString('hex')}`;
}
