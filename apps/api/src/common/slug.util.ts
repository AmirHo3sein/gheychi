import { randomBytes } from 'crypto';

export function makeSlug(name: string, fallbackPrefix = 'salon'): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length < 3) return `${fallbackPrefix}-${randomBytes(4).toString('hex')}`;
  return `${base}-${randomBytes(2).toString('hex')}`;
}
