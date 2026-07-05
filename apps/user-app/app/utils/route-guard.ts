export function isPublicRoute(path: string): boolean {
  if (path === '/login') return true
  if (path === '/salons' || path.startsWith('/salons/')) return true
  return false
}
