export function isPublicRoute(path: string): boolean {
  if (path === '/login') return true
  if (path === '/salons' || path.startsWith('/salons/')) return true
  if (path === '/blog' || path.startsWith('/blog/')) return true
  return false
}
