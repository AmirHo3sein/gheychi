import { isPublicRoute } from '../utils/route-guard'

export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSessionStore()
  const isPublic = isPublicRoute(to.path)

  // Only probe /auth/me for routes that actually require a session. This endpoint 401s
  // for anonymous visitors, and useApi's apiFetch unconditionally redirects to /login on
  // any 401 (regardless of `silent`) -- so eagerly calling it on a public route (/login,
  // /salons/:slug) would force a redirect away from the very page that's meant to stay
  // reachable without a session, defeating the point of gating by isPublicRoute at all.
  if (!session.checked && !isPublic) {
    const { apiFetch } = useApi()
    const { data } = await apiFetch<{ id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }>(
      '/auth/me',
      { silent: true },
    )
    session.setUser(data)
  }

  if (!session.isLoggedIn && !isPublic) {
    return navigateTo('/login')
  }
})
