import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CustomersView from './CustomersView.vue'

const CUSTOMERS = [
  { userId: 'u1', name: 'Ali', phone: '0912', bookingsCount: 1, completedCount: 1, lastVisitAt: '2026-08-01T10:00:00.000Z', grossValue: 300_000, segment: 'new' },
  { userId: 'u2', name: 'Sara', phone: '0913', bookingsCount: 5, completedCount: 4, lastVisitAt: '2026-08-15T10:00:00.000Z', grossValue: 1_500_000, segment: 'returning' },
]
const SUMMARY = { bookingsCount: 6, grossBookingValue: 1_800_000, onlineCollected: 360_000, commission: 36_000, estimatedSalonRevenue: 1_764_000 }
const SMS_QUOTA = { quota: 20, used: 3, remaining: 17 }

function stubFetchByUrl(overrides: { customers?: unknown; summary?: unknown; customersOk?: boolean; smsQuota?: unknown } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/dashboard-summary')) return Promise.resolve({ ok: true, status: 200, json: async () => overrides.summary ?? SUMMARY })
    if (url.includes('/sms-quota')) return Promise.resolve({ ok: true, status: 200, json: async () => overrides.smsQuota ?? SMS_QUOTA })
    return Promise.resolve({
      ok: overrides.customersOk ?? true,
      status: overrides.customersOk === false ? 500 : 200,
      json: async () => overrides.customers ?? CUSTOMERS,
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

describe('CustomersView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the dashboard summary with the precise financial labels', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('ارزش ناخالص نوبت‌ها')
    expect(wrapper.text()).toContain('دریافتی آنلاین')
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

  it('links each customer name to their detail page', async () => {
    stubFetchByUrl()
    const wrapper = await mountView()

    const link = wrapper.get('[data-testid="customer-row"] a')
    expect(link.attributes('href')).toBe('/customers/u1')
  })

  it('shows an empty state when the salon has no customers yet', async () => {
    stubFetchByUrl({ customers: [] })
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
})
