import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setUnauthorizedHandler, useApi } from '@/composables/useApi'
import { resetToast, useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'
import { SESSION_EXPIRED_MESSAGE, installSessionExpiryHandler } from './session-expiry'

function makeRouter() {
  const stub = { template: '<div />' }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: stub },
      { path: '/', name: 'dashboard', component: stub },
      { path: '/bookings', name: 'bookings', component: stub },
    ],
  })
}

describe('installSessionExpiryHandler', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetToast()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthorizedHandler(null)
  })

  it('pushes /login with the current path as ?redirect=, clears the session and toasts', async () => {
    const router = makeRouter()
    await router.push('/bookings')
    installSessionExpiryHandler(router)
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'S', gender: 'female', role: 'provider' })

    await useApi().apiFetch('/salons/mine/bookings')
    await new Promise((r) => setTimeout(r, 0))

    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/bookings')
    expect(useSessionStore().user).toBeNull()
    const [toast] = useToast().toasts.value
    expect(toast.message).toBe(SESSION_EXPIRED_MESSAGE)
    expect(toast.tone).toBe('error')
  })

  it('acts once for a burst of simultaneous 401s', async () => {
    const router = makeRouter()
    await router.push('/bookings')
    installSessionExpiryHandler(router)
    const { apiFetch } = useApi()

    await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])
    await new Promise((r) => setTimeout(r, 0))

    expect(useToast().toasts.value).toHaveLength(1)
  })

  it('does nothing when already on /login', async () => {
    const router = makeRouter()
    await router.push('/login')
    installSessionExpiryHandler(router)

    await useApi().apiFetch('/a')

    expect(useToast().toasts.value).toHaveLength(0)
    expect(router.currentRoute.value.query.redirect).toBeUndefined()
  })
})
