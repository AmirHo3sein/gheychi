import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DashboardView from './DashboardView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/hours', name: 'hours', component: { template: '<div />' } },
      { path: '/photos', name: 'photos', component: { template: '<div />' } },
      { path: '/stories', name: 'stories', component: { template: '<div />' } },
      { path: '/portfolio', name: 'portfolio', component: { template: '<div />' } },
      { path: '/coupons', name: 'coupons', component: { template: '<div />' } },
      { path: '/team', name: 'team', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
}

async function mountDashboard() {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  const wrapper = mount(DashboardView, { global: { plugins: [router] } })
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('DashboardView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not show a today booking again in the upcoming list', async () => {
    const today = new Date()
    const todayIso = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59).toISOString()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0).toISOString()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { id: 'b1', serviceId: 's1', startsAt: todayIso, status: 'confirmed' },
          { id: 'b2', serviceId: 's1', startsAt: tomorrow, status: 'confirmed' },
        ]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 's1', name: 'کوتاهی مو' }]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountDashboard()

    // b1 (today, late in the day but still "today") must appear only once -- in the today
    // section -- not also in "upcoming", even though `new Date(b1.startsAt) > new Date()` holds.
    const cards = wrapper.findAll('[class*="rounded-2xl"][class*="border"]').filter((c) => c.text().includes('کوتاهی مو'))
    expect(cards).toHaveLength(2)
  })

  it('renders a retry-capable error state (not the empty-schedule message) when the fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'خطای سرور' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountDashboard()

    expect(wrapper.text()).not.toContain('نوبتی برای امروز ثبت نشده است.')
    expect(wrapper.find('[data-testid="retry-dashboard"]').exists()).toBe(true)

    // Retry re-issues both requests.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ([]) })
    await wrapper.find('[data-testid="retry-dashboard"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="retry-dashboard"]').exists()).toBe(false)
  })
})
