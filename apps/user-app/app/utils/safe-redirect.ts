// Post-login destination handling. The `redirect` query param is attacker-controlled
// (anyone can send a victim `/login?redirect=https://evil.example`), so the only value
// ever honoured is a same-origin RELATIVE path. Everything else falls back to '/'.
//
// Rejected on purpose:
//   - anything not starting with a single '/'  (absolute URLs, `javascript:`, bare words)
//   - '//host' and '/\host'                    (protocol-relative; browsers treat '\' as '/')
//   - any backslash or control character       (browsers strip tab/CR/LF, so '/\t/evil.com'
//                                               would become '//evil.com' after parsing)
//   - any '://'                                (a scheme smuggled into the query string)
//   - the login page itself                    (would loop straight back here)
const FALLBACK = '/'

// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/

export function sanitizeRedirect(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK
  if (!raw.startsWith('/') || raw.startsWith('//')) return FALLBACK
  if (CONTROL_OR_BACKSLASH.test(raw)) return FALLBACK
  if (raw.includes('://')) return FALLBACK
  const path = raw.split(/[?#]/, 1)[0]!
  if (path === '/login' || path.startsWith('/login/')) return FALLBACK
  return raw
}

/**
 * The /login location to send an anonymous visitor to, remembering where they were going.
 * Falls back to a bare '/login' when there is nothing worth remembering (home, login itself,
 * or an unsafe path).
 */
export function loginLocation(destination?: string | null): string {
  const target = sanitizeRedirect(destination)
  if (target === FALLBACK) return '/login'
  return `/login?redirect=${encodeURIComponent(target)}`
}
