import { isPublicRoute } from '../utils/route-guard'
import type { SessionUser } from '../stores/session'

// The account page doubles as the profile-completion screen -- there is no separate
// onboarding route, and login.vue's own 'profile' step is unreachable once verify-otp
// has already returned (it can't be resumed from a fresh page load).
const PROFILE_COMPLETION_PATH = '/profile'

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
    // This probe can still be in flight when the user finishes an OTP login/profile
    // completion elsewhere in the same session (those call session.setUser() directly,
    // not through this middleware) -- on a slow connection or cold dev server, this
    // probe's stale "still anonymous" result can resolve AFTER that newer, authoritative
    // update. Only apply it if nothing more recent already has.
    if (!session.checked) session.setUser(data)
  }

  if (!session.isLoggedIn && !isPublicRoute(to.path)) {
    return navigateTo('/login')
  }

  // An account with no name/gender yet is not merely cosmetically incomplete: `gender` is a
  // REQUIRED /search param, so the home page can't load a single salon without it (see
  // index.vue's needsProfile guard). Nothing else forces completion -- verify-otp already
  // set the session cookie by the time login.vue shows its profile step, so abandoning the
  // tab there (or arriving from the provider panel, which never asks for a gender) leaves an
  // account stuck this way. /profile is the completion screen; public routes stay reachable
  // so an incomplete account can still browse salons and read the blog.
  if (session.needsProfileCompletion && to.path !== PROFILE_COMPLETION_PATH && !isPublicRoute(to.path)) {
    return navigateTo(PROFILE_COMPLETION_PATH)
  }
})
