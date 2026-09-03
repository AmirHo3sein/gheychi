import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session'
import { resetSalon } from '@/composables/useSalon'
import { resetFeatureFlags } from '@/composables/useFeatureFlags'
import { resetToast, useToast } from '@/composables/useToast'
import { createAppRouter } from './index'

vi.mock('@/pages/LoginView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/OnboardingView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/PendingApprovalView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/BookingsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/ServicesView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/HoursView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/PhotosView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/ReviewsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/EarningsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/SalonSettingsView.vue', () => ({ default: { template: '<div />' } }))

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSalon()
    resetFeatureFlags()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('sends a logged-in provider with no salon yet to /onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'u1', role: 'customer' }) })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: null, gender: null, role: 'customer' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  // A 5xx/network failure on the first /salons/mine probe is not "no salon yet" -- routing
  // it to onboarding would invite an owner with an approved salon to create a second one
  // (and 409). The navigation is cancelled with a toast instead, and because useSalon leaves
  // `checked` false on that path, the very next navigation probes again.
  it('does not send a provider to /onboarding when the salon probe fails with a 5xx, and re-probes on the next navigation', async () => {
    let salonStatus = 500
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'u1', role: 'provider' }) })
      }
      if (url.includes('/salons/mine')) {
        return salonStatus === 500
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    resetToast()

    const router = createAppRouter(createMemoryHistory())
    const failure = await router.push('/bookings')

    expect(failure).toBeTruthy() // navigation was cancelled, not redirected
    expect(router.currentRoute.value.name).not.toBe('onboarding')
    expect(useToast().toasts.value.some((t) => t.message.includes('بارگذاری نشد'))).toBe(true)

    // The API recovers; the next navigation must probe again rather than reuse the failed
    // result, and land where an approved salon belongs.
    salonStatus = 200
    const salonProbes = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/salons/mine')).length
    const probesBefore = salonProbes()
    await router.push('/bookings')

    expect(salonProbes()).toBe(probesBefore + 1)
    expect(router.currentRoute.value.name).toBe('bookings')
  })

  it('sends a provider with a pending salon to /pending-approval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  it('allows a provider with an approved salon through to the requested route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('bookings')
  })

  it('keeps an unauthenticated visitor already navigating to /login on /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('lets a provider with a rejected salon through to /settings to fix what got them rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'rejected' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/settings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('settings')
  })

  it('still bounces a provider with a rejected salon away from other protected routes to /pending-approval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'rejected' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  it('still bounces a suspended salon away from /settings (only "rejected" gets the exception)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'suspended' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/settings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  // The onboarding wizard creates the salon before saving hours/first service, so a failure
  // on either leaves a pending salon that can't be completed from the wizard after a reload.
  // Those two screens have to stay reachable, or an admin can approve an unbookable listing.
  it.each([
    ['/hours', 'hours'],
    ['/services', 'services'],
  ])('lets a provider with a pending salon through to %s to finish a half-created onboarding', async (path, name) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    await router.isReady()
    expect(router.currentRoute.value.name).toBe(name)
  })

  it('does not extend the pending hours/services exception to a suspended salon', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'suspended' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hours')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  it('keeps a logged-in provider with no salon yet on /onboarding when navigating there directly', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'u1', role: 'customer' }) })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: null, gender: null, role: 'customer' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/onboarding')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('onboarding')
  })
})
