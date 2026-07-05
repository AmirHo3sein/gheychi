import { isPublicRoute } from '../utils/route-guard'
import type { SessionUser } from '../stores/session'

export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSessionStore()

  if (!session.checked) {
    const { apiFetch } = useApi()
    // Always probe, even on public routes: a logged-in visitor landing on a public page
    // (e.g. /salons/:slug from search, or /login itself) still needs session.user
    // hydrated so the UI reflects that they're logged in. redirectOn401: false stops
    // apiFetch's own 401 handling from force-redirecting an anonymous visitor away from
    // a public page -- the explicit check below is the single place that decides that.
    const { data } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
    session.setUser(data)
  }

  if (!session.isLoggedIn && !isPublicRoute(to.path)) {
    return navigateTo('/login')
  }
})
