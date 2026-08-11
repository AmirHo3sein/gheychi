import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useSessionStore } from '../../app/stores/session'
import authMiddleware from '../../app/middleware/auth.global'

// Same pattern as useApi.spec.ts: `$fetch` is a real globalThis binding, not an
// unimport-tracked auto-import, so it's stubbed directly rather than via mockNuxtImport.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

// `defineNuxtRouteMiddleware` is an identity function at runtime (a build-time marker
// only), so the middleware's default export can be invoked directly like a plain
// `(to, from) => ...` handler -- only `to.path` is read, so a minimal object stands in
// for the real `RouteLocationNormalized`.
function toRoute(path: string) {
  return { path } as Parameters<typeof authMiddleware>[0]
}

describe('auth.global middleware', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    useSessionStore().$reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('probes the session on a public route but does not redirect even when the probe 401s', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    await authMiddleware(toRoute('/salons/best-salon-tehran'), toRoute('/'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(useSessionStore().isLoggedIn).toBe(false)
  })

  it('does not redirect an anonymous visitor landing on the home page itself', async () => {
    // Real discovery/marketing content -- an unauthenticated visitor must be able to land
    // directly on '/', not get bounced to /login before ever seeing it.
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    await authMiddleware(toRoute('/'), toRoute('/'))

    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('redirects exactly once to /login for a private route with no session', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    await authMiddleware(toRoute('/profile'), toRoute('/'))

    expect(navigateToMock).toHaveBeenCalledTimes(1)
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('does not re-probe or redirect on a private route once the session is already checked', async () => {
    const session = useSessionStore()
    session.setUser({ id: '1', phone: '09120000000', name: 'Test', gender: 'male', role: 'customer' })

    await authMiddleware(toRoute('/profile'), toRoute('/'))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('sends a logged-in user with no gender to /profile instead of a home page that cannot load', async () => {
    // The account is real and the cookie is valid, but `gender` is a REQUIRED /search
    // param -- without it the home page could only ever render its retry-forever error
    // card. Trivially reachable: verify-otp sets the session before login.vue's profile
    // step, so abandoning the tab there leaves the account permanently in this state.
    const session = useSessionStore()
    session.setUser({ id: '1', phone: '09120000000', name: 'Test', gender: null, role: 'customer' })

    await authMiddleware(toRoute('/'), toRoute('/'))

    expect(navigateToMock).toHaveBeenCalledTimes(1)
    expect(navigateToMock).toHaveBeenCalledWith('/profile')
  })

  it('sends a logged-in user with no name to /profile as well', async () => {
    const session = useSessionStore()
    session.setUser({ id: '1', phone: '09120000000', name: null, gender: 'female', role: 'customer' })

    await authMiddleware(toRoute('/bookings'), toRoute('/'))

    expect(navigateToMock).toHaveBeenCalledWith('/profile')
  })

  it('does not bounce the incomplete-profile user off /profile itself, or off a public route', async () => {
    const session = useSessionStore()
    session.setUser({ id: '1', phone: '09120000000', name: null, gender: null, role: 'customer' })

    await authMiddleware(toRoute('/profile'), toRoute('/'))
    await authMiddleware(toRoute('/salons/best-salon-tehran'), toRoute('/'))

    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('leaves a complete profile alone', async () => {
    const session = useSessionStore()
    session.setUser({ id: '1', phone: '09120000000', name: 'Test', gender: 'female', role: 'customer' })

    await authMiddleware(toRoute('/'), toRoute('/'))

    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('does not let a slow initial probe clobber a session set elsewhere while the probe was still in flight', async () => {
    // Reproduces a real race: this middleware's own /auth/me probe (fired on the very
    // first navigation, while the session is still anonymous) can still be in flight
    // when the user finishes an OTP login + profile-completion flow moments later --
    // those call session.setUser() directly, outside this middleware. If the slow probe
    // then resolves as still-anonymous, it must not overwrite the newer, authoritative
    // logged-in state.
    const session = useSessionStore()
    let rejectProbe: (reason: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectProbe = reject }))

    const middlewarePromise = authMiddleware(toRoute('/'), toRoute('/'))

    // While the probe above is still pending, a more recent, authoritative update lands.
    session.setUser({ id: '1', phone: '09120000000', name: 'Test', gender: 'male', role: 'customer' })

    // The stale probe now resolves as it would for the anonymous visitor it was actually
    // sent for -- a 401.
    rejectProbe({ response: { status: 401 } })
    await middlewarePromise

    expect(session.isLoggedIn).toBe(true)
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
