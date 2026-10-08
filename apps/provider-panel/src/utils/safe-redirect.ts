/**
 * Validates a `?redirect=` value before the login screen navigates to it. Only a same-origin,
 * in-app path is accepted: it must start with exactly one `/`. `//host` and `/\host` are
 * protocol-relative URLs browsers resolve to another origin, and anything with a scheme
 * (`https:`, `javascript:`) or a control character never starts with a plain `/` path anyway.
 * Returns null for anything else (and for /login itself, which would loop).
 */
export function sanitizeRedirect(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return null
  return value
}
