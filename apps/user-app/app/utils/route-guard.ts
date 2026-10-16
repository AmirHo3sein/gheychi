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

/**
 * Whether the marketing footer (AppFooter) belongs on this route. Only the public, crawlable
 * surfaces get it -- its job is internal links for search engines (see AppFooter.vue). App
 * screens (bookings, profile, account, checkout, Beauty Guide) are noindex/auth-gated, and a
 * link block stacked above the phone tab bar there made the app read like a website.
 * /login is public but has its own bare layout, so it is excluded explicitly.
 */
export function showsSiteFooter(path: string): boolean {
  return path !== '/login' && isPublicRoute(path)
}
