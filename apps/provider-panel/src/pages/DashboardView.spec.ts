import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DashboardView from './DashboardView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/customers', name: 'customers', component: { template: '<div />' } },
      { path: '/hours', name: 'hours', component: { template: '<div />' } },
      { path: '/photos', name: 'photos', component: { template: '<div />' } },
      { path: '/stories', name: 'stories', component: { template: '<div />' } },
      { path: '/portfolio', name: 'portfolio', component: { template: '<div />' } },
      { path: '/coupons', name: 'coupons', component: { template: '<div />' } },
      { path: '/team', name: 'team', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
      { path: '/plan', name: 'plan', component: { template: '<div />' } },
    ],
  })
}

function period(overrides: Record<string, unknown> = {}) {
  return {
    bookingsCount: 0,
    grossBookingValue: 0,
    onlineCollected: 0,
    commission: 0,
    estimatedSalonRevenue: 0,
    distinctCustomers: 0,
    newCustomers: 0,
    returningCustomers: 0,
    completedCount: 0,
    cancelledCount: 0,
    noShowCount: 0,
    averageBookingValue: 0,
    repeatRatePercent: 0,
    ...overrides,
  }
}

const SUMMARY = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  ...period({
    bookingsCount: 20,
    grossBookingValue: 10_000_000,
    onlineCollected: 2_000_000,
    distinctCustomers: 12,
    newCustomers: 4,
    returningCustomers: 8,
    completedCount: 15,
    cancelledCount: 2,
    noShowCount: 1,
    averageBookingValue: 500_000,
    repeatRatePercent: 67,
  }),
  previous: period({ bookingsCount: 10, distinctCustomers: 8, grossBookingValue: 8_000_000, cancelledCount: 4 }),
  topServices: [{ serviceId: 's1', name: 'کوتاهی مو', bookingsCount: 9, grossValue: 2_700_000 }],
  topWorkers: [{ workerId: 'w1', name: 'مریم', bookingsCount: 6 }],
  busiestWeekday: 3,
  busiestHour: 18,
}

const FUNNEL = {
  stages: [
    { stage: 'salon_profile_viewed', count: 200, conversionFromPreviousPercent: null },
    { stage: 'booking_started', count: 50, conversionFromPreviousPercent: 25 },
    { stage: 'booking_confirmed', count: 25, conversionFromPreviousPercent: 50 },
  ],
}

// Routed by URL, not call order: this screen fires four independent requests on mount
// (bookings, services, dashboard-summary, funnel) and an order-coupled mock would break on
// any change to which Promise.all a request belongs to.
function stubFetch(overrides: {
  bookings?: unknown
  services?: unknown
  summary?: unknown
  funnel?: unknown
  summaryOk?: boolean
  funnelOk?: boolean
  bookingsOk?: boolean
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/dashboard-summary')) {
      return Promise.resolve({
        ok: overrides.summaryOk ?? true,
        status: overrides.summaryOk === false ? 500 : 200,
        json: async () => overrides.summary ?? SUMMARY,
      })
    }
    if (url.includes('/funnel')) {
      return Promise.resolve({
        ok: overrides.funnelOk ?? true,
        status: overrides.funnelOk === false ? 500 : 200,
        json: async () => overrides.funnel ?? FUNNEL,
      })
    }
    if (url.includes('/services')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => overrides.services ?? [] })
    }
    return Promise.resolve({
      ok: overrides.bookingsOk ?? true,
      status: overrides.bookingsOk === false ? 500 : 200,
      json: async () => overrides.bookings ?? [],
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

    stubFetch({
      bookings: [
        { id: 'b1', serviceId: 's1', startsAt: todayIso, status: 'confirmed' },
        { id: 'b2', serviceId: 's1', startsAt: tomorrow, status: 'confirmed' },
      ],
      services: [{ id: 's1', name: 'کوتاهی مو' }],
      // Emptied so the "top services" card above can't contribute a third card carrying
      // the same service name to the count below.
      summary: { ...SUMMARY, topServices: [] },
    })

    const wrapper = await mountDashboard()

    // b1 (today, late in the day but still "today") must appear only once -- in the today
    // section -- not also in "upcoming", even though `new Date(b1.startsAt) > new Date()` holds.
    const cards = wrapper.findAll('[class*="rounded-2xl"][class*="border"]').filter((c) => c.text().includes('کوتاهی مو'))
    expect(cards).toHaveLength(2)
  })

  it('renders a retry-capable error state (not the empty-schedule message) when the bookings fetch fails', async () => {
    const fetchMock = stubFetch({ bookingsOk: false })

    const wrapper = await mountDashboard()

    expect(wrapper.text()).not.toContain('نوبتی برای امروز ثبت نشده است.')
    expect(wrapper.find('[data-testid="retry-dashboard"]').exists()).toBe(true)

    // Retry re-issues both bookings requests -- and only those, not the metrics ones.
    fetchMock.mockClear()
    stubFetch()
    await wrapper.find('[data-testid="retry-dashboard"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-dashboard"]').exists()).toBe(false)
  })

  it('shows the period metrics with a previous-period comparison on each tile', async () => {
    stubFetch()

    const wrapper = await mountDashboard()

    const bookingsTile = wrapper.get('[data-testid="metric-bookings"]')
    expect(bookingsTile.text()).toContain((20).toLocaleString('fa-IR'))
    // 20 vs 10 last period.
    expect(bookingsTile.text()).toContain(`+${(100).toLocaleString('fa-IR')}٪`)

    const customersTile = wrapper.get('[data-testid="metric-customers"]')
    expect(customersTile.text()).toContain('جدید')
    expect(customersTile.text()).toContain('بازگشتی')
  })

  it('says the previous period has no data rather than showing a meaningless percentage', async () => {
    stubFetch()

    const wrapper = await mountDashboard()

    // no_show was 0 last period: a percentage change off a zero base is undefined, and
    // rendering "0%" or "+∞%" would both be lies.
    expect(wrapper.get('[data-testid="metric-no-show"]').text()).toContain('دورهٔ قبل داده‌ای ندارد')
  })

  it('reads a drop in cancellations as good news, not bad', async () => {
    stubFetch()

    const wrapper = await mountDashboard()

    // 2 this period vs 4 before -- down 50%, and down is the good direction here.
    const tile = wrapper.get('[data-testid="metric-cancelled"]')
    expect(tile.text()).toContain(`−${(50).toLocaleString('fa-IR')}٪`)
    expect(tile.html()).toContain('--tone-success-text')
  })

  it('refetches the metrics (and only the metrics) when the period changes', async () => {
    const fetchMock = stubFetch()

    const wrapper = await mountDashboard()
    fetchMock.mockClear()

    await wrapper.get('[data-testid="period-7"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls).toHaveLength(2)
    expect(urls.some((u) => u.includes('/dashboard-summary'))).toBe(true)
    expect(urls.some((u) => u.includes('/funnel'))).toBe(true)
  })

  it('sends the same explicit window to both metrics endpoints, so the two cards cannot disagree', async () => {
    const fetchMock = stubFetch()

    await mountDashboard()

    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    const summaryUrl = new URL(urls.find((u) => u.includes('/dashboard-summary'))!, 'http://x')
    const funnelUrl = new URL(urls.find((u) => u.includes('/funnel'))!, 'http://x')
    expect(summaryUrl.searchParams.get('from')).toBe(funnelUrl.searchParams.get('from'))
    expect(summaryUrl.searchParams.get('to')).toBe(funnelUrl.searchParams.get('to'))
  })

  it('renders the top services, top workers, and the Tehran-local busiest time', async () => {
    stubFetch()

    const wrapper = await mountDashboard()

    expect(wrapper.get('[data-testid="top-service"]').text()).toContain('کوتاهی مو')
    expect(wrapper.get('[data-testid="top-worker"]').text()).toContain('مریم')
    // busiestWeekday 3 = Wednesday on Postgres' 0=Sunday scale.
    expect(wrapper.get('[data-testid="busiest-time"]').text()).toContain('چهارشنبه')
  })

  it('renders the funnel stages with their conversion off the stage before', async () => {
    stubFetch()

    const wrapper = await mountDashboard()

    const stages = wrapper.findAll('[data-testid="funnel-stage"]')
    expect(stages).toHaveLength(3)
    expect(stages[0]!.text()).toContain('بازدید از صفحهٔ سالن')
    expect(stages[0]!.text()).toContain('—') // no stage before it to convert from
    expect(stages[1]!.text()).toContain(`${(25).toLocaleString('fa-IR')}٪`)
  })

  it('shows an honest empty state for a funnel with no events yet, instead of a row of zeros', async () => {
    stubFetch({
      funnel: {
        stages: [
          { stage: 'salon_profile_viewed', count: 0, conversionFromPreviousPercent: null },
          { stage: 'booking_started', count: 0, conversionFromPreviousPercent: null },
          { stage: 'booking_confirmed', count: 0, conversionFromPreviousPercent: null },
        ],
      },
    })

    const wrapper = await mountDashboard()

    expect(wrapper.find('[data-testid="funnel-stage"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="funnel-empty"]').text()).toContain('هنوز داده‌ای برای این دوره ثبت نشده است')
  })

  it('keeps the bookings sections working when the metrics endpoints are down', async () => {
    stubFetch({ summaryOk: false, bookings: [], services: [] })

    const wrapper = await mountDashboard()

    expect(wrapper.find('[data-testid="retry-metrics"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-dashboard"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('نوبتی برای امروز ثبت نشده است.')
  })
})
