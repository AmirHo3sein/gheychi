import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CustomersView from './CustomersView.vue'

const CUSTOMERS = [
  {
    userId: 'u1', name: 'Ali', phone: '0912', bookingsCount: 1, completedCount: 1, visitsCount: 0,
    firstVisitAt: null, lastVisitAt: null, grossValue: 300_000, segment: 'new',
  },
  {
    userId: 'u2', name: 'Sara', phone: '0913', bookingsCount: 5, completedCount: 4, visitsCount: 4,
    firstVisitAt: '2026-05-01T10:00:00.000Z', lastVisitAt: '2026-08-15T10:00:00.000Z', grossValue: 1_500_000, segment: 'returning',
  },
]
const SUMMARY = { bookingsCount: 6, grossBookingValue: 1_800_000, onlineCollected: 360_000, commission: 36_000, estimatedSalonRevenue: 1_764_000 }
const SMS_QUOTA = { quota: 20, used: 3, remaining: 17 }

function page(items: unknown[], total = items.length) {
  return { items, total, page: 1, pageSize: 20 }
}

function stubFetchByUrl(
  overrides: { customers?: unknown; summary?: unknown; customersOk?: boolean; smsQuota?: unknown } = {},
) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/dashboard-summary')) return Promise.resolve({ ok: true, status: 200, json: async () => overrides.summary ?? SUMMARY })
    if (url.includes('/sms-quota')) return Promise.resolve({ ok: true, status: 200, json: async () => overrides.smsQuota ?? SMS_QUOTA })
    return Promise.resolve({
      ok: overrides.customersOk ?? true,
      status: overrides.customersOk === false ? 500 : 200,
      json: async () => overrides.customers ?? page(CUSTOMERS),
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/customers', component: CustomersView },
      { path: '/customers/:id', component: { template: '<div />' } },
    ],
  })
  router.push('/customers')
  await router.isReady()
  const wrapper = mount(CustomersView, { global: { plugins: [router] } })
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

/** The search box is debounced by 300ms; nothing is requested before that elapses. */
async function flushDebounce() {
  await new Promise((r) => setTimeout(r, 350))
}

function customersUrls(fetchMock: ReturnType<typeof stubFetchByUrl>): string[] {
  return fetchMock.mock.calls
    .map((c) => c[0] as string)
    .filter((u) => u.includes('/salons/mine/customers'))
}

describe('CustomersView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the dashboard summary with the precise financial labels', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('ارزش ناخالص نوبت‌ها')
    // "دریافتی آنلاین" alone read as revenue; what is actually captured is the deposit.
    expect(wrapper.text()).toContain('بیعانهٔ آنلاین دریافتی')
    expect(wrapper.text()).toContain('کارمزد پلتفرم')
    expect(wrapper.text()).toContain('درآمد تخمینی سالن')
    expect(wrapper.text()).toContain('تخمینی')
  })

  it('shows the remaining monthly SMS quota', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="sms-quota-summary"]').text()).toContain('17')
    expect(wrapper.get('[data-testid="sms-quota-summary"]').text()).toContain('20')
  })

  it('lists each customer with their name, phone, and segment badge', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-testid="customer-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Ali')
    expect(rows[0]!.text()).toContain('مشتری جدید')
    expect(rows[1]!.text()).toContain('Sara')
    expect(rows[1]!.text()).toContain('مشتری وفادار')
  })

  it('separates total bookings from visits that actually happened', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('کل نوبت‌ها')
    expect(wrapper.text()).toContain('مراجعه‌های انجام‌شده')
    expect(wrapper.text()).toContain('اولین مراجعه')
    // Ali has one booking, still in the future -- one booking, zero visits, and a dash
    // rather than a date for a visit that has not happened.
    const ali = wrapper.findAll('[data-testid="customer-row"]')[0]!
    expect(ali.text()).toContain('—')
  })

  it('links each customer name to their detail page', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    const link = wrapper.get('[data-testid="customer-row"] a')
    expect(link.attributes('href')).toBe('/customers/u1')
  })

  it('shows an empty state when the salon has no customers yet', async () => {
    stubFetchByUrl({ customers: page([]) })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('هنوز مشتری‌ای برای این سالن ثبت نشده است.')
  })

  it('shows a retryable error state when the customers fetch fails', async () => {
    stubFetchByUrl({ customersOk: false })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="retry-customers"]').exists()).toBe(true)

    stubFetchByUrl()
    await wrapper.get('[data-testid="retry-customers"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-customers"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="customer-row"]')).toHaveLength(2)
  })

  it('sends the search text to the server, debounced', async () => {
    const fetchMock = stubFetchByUrl()
    const wrapper = await mountView()
    const before = customersUrls(fetchMock).length

    await wrapper.get('input[data-testid="customer-search"]').setValue('مریم')
    expect(customersUrls(fetchMock)).toHaveLength(before) // not yet -- still debouncing

    await flushDebounce()

    const urls = customersUrls(fetchMock)
    expect(urls).toHaveLength(before + 1)
    expect(urls.at(-1)).toContain(`q=${encodeURIComponent('مریم')}`)
    expect(urls.at(-1)).toContain('page=1')
  })

  it('collapses a burst of keystrokes into a single request', async () => {
    const fetchMock = stubFetchByUrl()
    const wrapper = await mountView()
    const before = customersUrls(fetchMock).length

    const input = wrapper.get('input[data-testid="customer-search"]')
    await input.setValue('م')
    await input.setValue('مر')
    await input.setValue('مریم')
    await flushDebounce()

    expect(customersUrls(fetchMock)).toHaveLength(before + 1)
  })

  it('ignores a stale response that arrives after a newer one', async () => {
    // The exact race a debounced search box produces: the request for "مر" is slow, the
    // one for "مریم" is fast. Without a sequence guard the slow, older response repaints
    // the table last and the list no longer matches what the box says.
    let resolveSlow: (v: unknown) => void = () => {}
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/dashboard-summary')) return Promise.resolve({ ok: true, status: 200, json: async () => SUMMARY })
      if (url.includes('/sms-quota')) return Promise.resolve({ ok: true, status: 200, json: async () => SMS_QUOTA })
      if (url.includes('q=')) {
        const stale = url.includes(encodeURIComponent('مر')) && !url.includes(encodeURIComponent('مریم'))
        if (stale) return new Promise((resolve) => { resolveSlow = resolve })
        return Promise.resolve({ ok: true, status: 200, json: async () => page([CUSTOMERS[1]]) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => page(CUSTOMERS) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountView()
    const input = wrapper.get('input[data-testid="customer-search"]')

    await input.setValue('مر')
    await flushDebounce()
    await input.setValue('مریم')
    await flushDebounce()

    // Only the newer result is on screen...
    expect(wrapper.findAll('[data-testid="customer-row"]')).toHaveLength(1)

    // ...and the older one landing late must not overwrite it.
    resolveSlow({ ok: true, status: 200, json: async () => page(CUSTOMERS) })
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.findAll('[data-testid="customer-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('Sara')
  })

  it('offers a way out of a filter that matched nothing', async () => {
    const fetchMock = stubFetchByUrl({ customers: page([]) })
    const wrapper = await mountView()

    await wrapper.get('input[data-testid="customer-search"]').setValue('کسی')
    await flushDebounce()

    expect(wrapper.get('[data-testid="no-results"]').text()).toContain('مشتری‌ای با این جستجو پیدا نشد.')
    // Distinct from the "no customers at all" state, which is a milestone, not a dead end.
    expect(wrapper.text()).not.toContain('هنوز مشتری‌ای برای این سالن ثبت نشده است.')

    fetchMock.mockClear()
    await wrapper.get('[data-testid="clear-filters"]').trigger('click')
    await flushDebounce()

    expect(customersUrls(fetchMock).at(-1)).not.toContain('q=')
  })

  it('pages through the list, showing the true total rather than the page length', async () => {
    const fetchMock = stubFetchByUrl({ customers: { items: CUSTOMERS, total: 45, page: 1, pageSize: 20 } })
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="customer-range"]').text()).toContain('45')

    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(customersUrls(fetchMock).at(-1)).toContain('page=2')
  })

  it('does not offer a previous page from the first one', async () => {
    stubFetchByUrl({ customers: { items: CUSTOMERS, total: 45, page: 1, pageSize: 20 } })
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="prev-page"]').attributes('disabled')).toBeDefined()
  })

  it('hides the pager entirely when everything fits on one page', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="customer-range"]').text()).toContain('2')
  })
})
