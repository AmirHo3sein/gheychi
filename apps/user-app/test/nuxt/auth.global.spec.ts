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

  it('redirects exactly once to /login for a private route with no session', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    await authMiddleware(toRoute('/'), toRoute('/'))

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
})
