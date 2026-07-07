import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session'
import { resetSalon } from '@/composables/useSalon'
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

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSalon()
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
})
