const LEGAL_PATHS = new Set(['/terms', '/privacy', '/booking-policy'])

export function isPublicRoute(path: string): boolean {
  if (path === '/') return true
  if (path === '/login') return true
  if (path === '/salons' || path.startsWith('/salons/')) return true
  if (path === '/blog' || path.startsWith('/blog/')) return true
  // Legal documents must be readable before an account exists (the login screen links to them).
  if (LEGAL_PATHS.has(path)) return true
  return false
}
