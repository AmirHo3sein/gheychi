import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureFlags, useFeatureFlags } from '@/composables/useFeatureFlags'
import { reportBookings, resetPendingApprovals } from '@/composables/usePendingApprovals'
import { tehranDateString } from '@/utils/tehran-date'
import DashboardView from './DashboardView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/bookings', name: 'bookings', component: { template: '<div />' } },
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

function capDay(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date, weekday: 0, closedReason: null, openMinutes: 600, capacityMinutes: 1200, bookedMinutes: 300,
    freeMinutes: 900, freePercent: 75, bookingsCount: 3, ...overrides,
  }
}
const CAPACITY = {
  from: '2026-10-16',
  to: '2026-10-23',
  capacity: 2,
  days: [
    capDay('2026-10-16', { bookedMinutes: 1200, freeMinutes: 0, freePercent: 0, bookingsCount: 9 }),
    capDay('2026-10-17'),
    capDay('2026-10-18', { closedReason: 'closed_exception', openMinutes: 0, capacityMinutes: 0, bookedMinutes: 0, freeMinutes: 0, freePercent: null, bookingsCount: 0 }),
    capDay('2026-10-19'),
    capDay('2026-10-20'),
    capDay('2026-10-21'),
    capDay('2026-10-22'),
  ],
  totals: { openMinutes: 3600, capacityMinutes: 7200, bookedMinutes: 2700, freeMinutes: 4500, freePercent: 63 },
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
  capacity?: unknown
  capacityOk?: boolean
} = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/capacity')) {
      return Promise.resolve({
        ok: overrides.capacityOk ?? true,
        status: overrides.capacityOk === false ? 500 : 200,
        json: async () => overrides.capacity ?? CAPACITY,
      })
    }
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
    resetFeatureFlags()
    resetPendingApprovals()
  })

  it('shows a metrics skeleton (not a bare spinner) until the summary arrives', async () => {
    // Never resolves: the metrics requests stay pending.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(DashboardView, { global: { plugins: [router] } })
    await new Promise((r) => setTimeout(r, 0))

    const skeleton = wrapper.get('[data-testid="metrics-skeleton"]')
    expect(skeleton.attributes('role')).toBe('status')
    expect(skeleton.findAll('.animate-pulse')).toHaveLength(8)
  })

  // Intentional change: the quick-link tile grid was removed -- the sidebar (lg+) and the
  // «بیشتر» page (phones) now reach every screen, so the grid only duplicated navigation.
  it('no longer duplicates the navigation as a quick-link grid', async () => {
    stubFetch()
    const wrapper = await mountDashboard()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    for (const to of ['/customers', '/packages', '/hours', '/photos', '/team', '/settings', '/plan']) {
      expect(hrefs).not.toContain(to)
    }
  })

  it('leads with a callout linking to the bookings screen while requests await approval', async () => {
    stubFetch()
    const wrapper = await mountDashboard()
    expect(wrapper.find('[data-testid="dashboard-pending-callout"]').exists()).toBe(false)

    reportBookings([
      { id: 'b1', status: 'pending_approval' },
      { id: 'b2', status: 'pending_approval' },
    ])
    await wrapper.vm.$nextTick()

    const callout = wrapper.get('[data-testid="dashboard-pending-callout"]')
    expect(callout.attributes('href')).toBe('/bookings')
    expect(callout.text()).toContain(`${(2).toLocaleString('fa-IR')} درخواست نوبت منتظر تأیید شماست`)
  })

  it('does not show a today booking again in the upcoming list', async () => {
    // Built on the Tehran calendar day (the screen's own definition of "today"), not the test
    // machine's local day. Iran has observed a fixed +03:30 since 2022.
    const todayKey = tehranDateString(new Date())
    const tomorrowKey = tehranDateString(new Date(Date.now() + 86_400_000))
    const todayIso = new Date(`${todayKey}T23:59:00+03:30`).toISOString()
    const tomorrow = new Date(`${tomorrowKey}T09:00:00+03:30`).toISOString()

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

  it('shows the next 7 days of free capacity, today first and highlighted, with closed days as «تعطیل»', async () => {
    const fetchMock = stubFetch()
    const wrapper = await mountDashboard()

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/salons/mine/capacity'))).toBe(true)
    const rows = wrapper.findAll('[data-testid="capacity-day"]')
    expect(rows).toHaveLength(7)
    expect(rows[0]!.text()).toContain('امروز')
    expect(rows[0]!.text()).toContain(`${(0).toLocaleString('fa-IR')}٪`)
    expect(rows[0]!.classes()).toContain('bg-(--color-accent-soft)')
    expect(rows[1]!.text()).toContain(`${(75).toLocaleString('fa-IR')}٪`)
    // Nothing on offer is "closed", never "0% free".
    expect(rows[2]!.text()).toContain('تعطیل')
    expect(wrapper.get('[data-testid="capacity-total"]').text()).toContain(`${(63).toLocaleString('fa-IR')}٪`)
    // The explanation names the real basis, including the concurrent-capacity setting.
    expect(wrapper.get('[data-testid="capacity-card"]').text()).toContain(`ظرفیت همزمان ${(2).toLocaleString('fa-IR')} نفر`)
    expect(wrapper.get('[data-testid="capacity-week-link"]').attributes('href')).toBe('/bookings?view=week')
  })

  it('draws the booked share (not the free share) as the solid bar, so an empty day is an empty bar', async () => {
    stubFetch({
      capacity: {
        ...CAPACITY,
        days: [capDay('2026-10-16', { bookedMinutes: 0, freeMinutes: 1200, freePercent: 100, bookingsCount: 0 }), ...CAPACITY.days.slice(1)],
      },
    })
    const wrapper = await mountDashboard()
    const rows = wrapper.findAll('[data-testid="capacity-day"]')
    // 100% free: no solid bar at all, and the label says «خالی» in words.
    expect(rows[0]!.find('[data-testid="capacity-booked-bar"]').exists()).toBe(false)
    expect(rows[0]!.text()).toContain(`${(100).toLocaleString('fa-IR')}٪ خالی`)
    // 75% free: the solid bar is the booked quarter.
    expect(rows[1]!.get('[data-testid="capacity-booked-bar"]').attributes('style')).toContain('width: 25%')
    expect(rows[1]!.text()).toContain(`${(75).toLocaleString('fa-IR')}٪ خالی`)
    // Closed: no bar.
    expect(rows[2]!.find('[data-testid="capacity-booked-bar"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="capacity-legend"]').text()).toContain('رزروشده')
  })

  it('says why there is no capacity figure when no working hours are open in the window', async () => {
    stubFetch({
      capacity: {
        ...CAPACITY,
        days: CAPACITY.days.map((d) => ({ ...d, closedReason: 'no_hours', openMinutes: 0, capacityMinutes: 0, bookedMinutes: 0, freeMinutes: 0, freePercent: null })),
        totals: { openMinutes: 0, capacityMinutes: 0, bookedMinutes: 0, freeMinutes: 0, freePercent: null },
      },
    })
    const wrapper = await mountDashboard()
    expect(wrapper.find('[data-testid="capacity-day"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="capacity-empty"]').text()).toContain('ساعت کاری باز ثبت نشده است')
    expect(wrapper.find('[data-testid="capacity-total"]').exists()).toBe(false)
  })

  it('keeps the rest of the dashboard working when capacity fails, and retries only capacity', async () => {
    const fetchMock = stubFetch({ capacityOk: false })
    const wrapper = await mountDashboard()
    expect(wrapper.find('[data-testid="retry-capacity"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="metric-bookings"]').exists()).toBe(true)

    fetchMock.mockClear()
    stubFetch()
    await wrapper.get('[data-testid="retry-capacity"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.findAll('[data-testid="capacity-day"]')).toHaveLength(7)
    expect(wrapper.find('[data-testid="retry-capacity"]').exists()).toBe(false)
  })

  it('treats a malformed capacity response as an error, not as an empty week', async () => {
    stubFetch({ capacity: { nope: true } })
    const wrapper = await mountDashboard()
    expect(wrapper.find('[data-testid="retry-capacity"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="capacity-empty"]').exists()).toBe(false)
  })

  it('orders the page today -> capacity -> performance and links today to the bookings tab', async () => {
    stubFetch()
    const wrapper = await mountDashboard()
    const html = wrapper.html()
    const today = html.indexOf('نوبت‌های امروز')
    const capacity = html.indexOf('data-testid="capacity-card"')
    const performance = html.indexOf('id="dashboard-performance"')
    expect(today).toBeGreaterThan(-1)
    expect(today).toBeLessThan(capacity)
    expect(capacity).toBeLessThan(performance)
    expect(wrapper.get('[data-testid="dashboard-today-link"]').attributes('href')).toBe('/bookings?tab=today')
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

  it('labels the payment stage instead of showing its raw event key', async () => {
    stubFetch({
      funnel: {
        stages: [
          { stage: 'salon_profile_viewed', count: 200, conversionFromPreviousPercent: null },
          { stage: 'booking_started', count: 50, conversionFromPreviousPercent: 25 },
          { stage: 'payment_succeeded', count: 40, conversionFromPreviousPercent: 80 },
          { stage: 'booking_confirmed', count: 40, conversionFromPreviousPercent: 100 },
        ],
      },
    })

    const wrapper = await mountDashboard()

    const stages = wrapper.findAll('[data-testid="funnel-stage"]')
    expect(stages).toHaveLength(4)
    expect(stages[2]!.text()).toContain('پرداخت بیعانه')
    expect(wrapper.text()).not.toContain('payment_succeeded')
    expect(wrapper.get('[data-testid="funnel-description"]').text()).toContain('پرداخت بیعانه')
  })

  // Free mode: nobody can pay online, so the payment stage would be a 0 "rescued" by a larger
  // confirmed count. It is hidden and conversion is recomputed between the shown rows.
  it('skips the payment stage and recomputes conversion when online payment is off', async () => {
    useFeatureFlags().flags.value.onlinePaymentEnabled = false
    stubFetch({
      funnel: {
        stages: [
          { stage: 'salon_profile_viewed', count: 67, conversionFromPreviousPercent: null },
          { stage: 'booking_started', count: 24, conversionFromPreviousPercent: 36 },
          { stage: 'payment_succeeded', count: 0, conversionFromPreviousPercent: 0 },
          { stage: 'booking_confirmed', count: 15, conversionFromPreviousPercent: null },
        ],
      },
    })

    const wrapper = await mountDashboard()

    const stages = wrapper.findAll('[data-testid="funnel-stage"]')
    expect(stages).toHaveLength(3)
    expect(wrapper.text()).not.toContain('پرداخت بیعانه')
    // 15 of 24 started, off the stage actually shown above it.
    expect(stages[2]!.text()).toContain(`${(63).toLocaleString('fa-IR')}٪`)
    expect(wrapper.get('[data-testid="funnel-description"]').text()).toContain('پرداخت آنلاین فعلاً روی پلتفرم خاموش است')
  })

  it('caps a step above 100% and explains why it can happen', async () => {
    stubFetch({
      funnel: {
        stages: [
          { stage: 'salon_profile_viewed', count: 67, conversionFromPreviousPercent: null },
          { stage: 'booking_started', count: 24, conversionFromPreviousPercent: 36 },
          { stage: 'payment_succeeded', count: 6, conversionFromPreviousPercent: 25 },
          { stage: 'booking_confirmed', count: 15, conversionFromPreviousPercent: 250 },
        ],
      },
    })

    const wrapper = await mountDashboard()

    const stages = wrapper.findAll('[data-testid="funnel-stage"]')
    expect(stages[3]!.text()).toContain('بیش از ۱۰۰٪')
    expect(stages[3]!.text()).not.toContain((250).toLocaleString('fa-IR'))
    expect(wrapper.find('[data-testid="funnel-overflow-note"]').exists()).toBe(true)
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

  describe('performance charts', () => {
    const DAILY = [
      { date: '2026-08-29', bookingsCount: 2, completedCount: 1, cancelledCount: 0, grossBookingValue: 400_000 },
      { date: '2026-08-30', bookingsCount: 0, completedCount: 0, cancelledCount: 1, grossBookingValue: 0 },
      { date: '2026-08-31', bookingsCount: 5, completedCount: 3, cancelledCount: 0, grossBookingValue: 1_500_000 },
    ]
    const WITH_SERIES = {
      ...SUMMARY,
      daily: DAILY,
      previousDaily: DAILY.map((d) => ({ ...d, bookingsCount: 1, grossBookingValue: 100_000 })),
      heatmap: [{ weekday: 6, hour: 10, count: 4 }, { weekday: 3, hour: 18, count: 1 }],
    }

    it('draws the daily trend with a previous-period overlay, and switches to booking value', async () => {
      stubFetch({ summary: WITH_SERIES })
      const wrapper = await mountDashboard()

      const card = wrapper.get('[data-testid="trend-card"]')
      expect(card.find('[data-testid="trend-line"]').attributes('d')).toMatch(/^M/)
      expect(card.find('[data-testid="trend-previous"]').exists()).toBe(true)
      // Screen-reader table: one row per day, in the count unit.
      expect(card.findAll('tbody tr')).toHaveLength(3)
      expect(card.get('tbody tr:last-child').text()).toContain(`${(5).toLocaleString('fa-IR')} نوبت`)

      await wrapper.get('[data-testid="trend-metric-gross"]').trigger('click')
      expect(wrapper.get('[data-testid="trend-metric-gross"]').attributes('aria-pressed')).toBe('true')
      expect(card.get('tbody tr:last-child').text()).toContain(`${(1_500_000).toLocaleString('fa-IR')} تومان`)
    })

    it('reports the active day through the keyboard, newest first', async () => {
      stubFetch({ summary: WITH_SERIES })
      const wrapper = await mountDashboard()
      const chart = wrapper.get('[data-testid="trend-chart"]')

      await chart.trigger('keydown', { key: 'End' })
      expect(wrapper.get('[data-testid="trend-tooltip"]').text()).toContain(`${(5).toLocaleString('fa-IR')} نوبت`)
      // RTL: the right arrow steps back in time.
      await chart.trigger('keydown', { key: 'ArrowRight' })
      expect(wrapper.get('[data-testid="trend-tooltip"]').text()).toContain(`${(0).toLocaleString('fa-IR')} نوبت`)
    })

    it('splits the period bookings by outcome, with upcoming = active minus completed', async () => {
      stubFetch({ summary: WITH_SERIES })
      const wrapper = await mountDashboard()

      const legend = wrapper.findAll('[data-testid="donut-legend"]').map((b) => b.text())
      // SUMMARY: 20 active of which 15 completed, 2 cancelled, 1 no-show → 23 in all.
      expect(legend[0]).toContain('انجام‌شده')
      expect(legend[0]).toContain((15).toLocaleString('fa-IR'))
      expect(legend[1]).toContain((5).toLocaleString('fa-IR'))
      expect(legend[2]).toContain((2).toLocaleString('fa-IR'))
      expect(legend[3]).toContain((1).toLocaleString('fa-IR'))
      expect(wrapper.get('[data-testid="donut-center"]').text()).toBe((23).toLocaleString('fa-IR'))
    })

    it('shows the new/returning split with its shares', async () => {
      stubFetch({ summary: WITH_SERIES })
      const wrapper = await mountDashboard()
      const mix = wrapper.get('[data-testid="customer-mix-card"]').text()
      expect(mix).toContain(`${(4).toLocaleString('fa-IR')} (${(33).toLocaleString('fa-IR')}٪)`)
      expect(mix).toContain(`${(8).toLocaleString('fa-IR')} (${(67).toLocaleString('fa-IR')}٪)`)
    })

    it('places appointments in the weekday x hour heatmap', async () => {
      stubFetch({ summary: WITH_SERIES })
      const wrapper = await mountDashboard()
      const heat = wrapper.get('[data-testid="heatmap"]')
      expect(heat.findAll('[data-testid="heatmap-cell-active"]')).toHaveLength(2)
      // Saturday leads the Iranian week.
      expect(heat.get('tbody tr th').text()).toContain('شنبه')
      expect(heat.get('tbody tr').text()).toContain(`${(4).toLocaleString('fa-IR')} نوبت`)
    })

    it('draws no charts from data it does not have (an API without the series)', async () => {
      stubFetch()
      const wrapper = await mountDashboard()
      expect(wrapper.find('[data-testid="trend-card"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="heatmap"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="sparkline"]').exists()).toBe(false)
      // The tiles and rankings still render from the totals.
      expect(wrapper.find('[data-testid="metric-bookings"]').exists()).toBe(true)
    })

    it('says so honestly when the period is empty instead of drawing a fake shape', async () => {
      const empty = DAILY.map((d) => ({ ...d, bookingsCount: 0, completedCount: 0, cancelledCount: 0, grossBookingValue: 0 }))
      stubFetch({ summary: { ...SUMMARY, ...period(), previous: period(), topServices: [], topWorkers: [], busiestWeekday: null, busiestHour: null, daily: empty, previousDaily: empty, heatmap: [] } })
      const wrapper = await mountDashboard()
      expect(wrapper.find('[data-testid="trend-empty"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="trend-previous"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="outcome-empty"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="heatmap"]').exists()).toBe(false)
    })
  })
})
