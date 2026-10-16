import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanView from './PlanView.vue'

const RESPONSE = {
  subscription: { status: 'active' },
  plan: { id: 'plan-free', key: 'free', name: 'رایگان', description: 'پلن پیش‌فرض هر سالن جدید', monthlyPriceToman: 0 },
  resolvedEntitlements: {},
}

async function mountPlan() {
  const wrapper = mount(PlanView)
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('PlanView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the current plan name, description, and price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE }))

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('رایگان')
    expect(wrapper.text()).toContain('پلن پیش‌فرض هر سالن جدید')
    expect(wrapper.text()).toContain('رایگان')
  })

  it('shows a retryable error state (not a blank page) when the fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'خطا' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('اطلاعات پلن بارگذاری نشد.')
    expect(wrapper.find('[data-testid="retry-plan"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE })
    await wrapper.get('[data-testid="retry-plan"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-plan"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('رایگان')
  })

  it('lists non-empty entitlements as key/value rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        // crmCustomerCap now has a Persian label (registry key); an unregistered key still
        // falls back to its raw name.
        json: async () => ({ ...RESPONSE, resolvedEntitlements: { smsMonthlyQuota: 100, crmCustomerCap: 50, someFutureKey: true } }),
      }),
    )

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('سقف پیامک ماهانه')
    expect(wrapper.text()).toContain('۱۰۰')
    expect(wrapper.text()).toContain('سقف مشتریان CRM')
    expect(wrapper.text()).toContain('someFutureKey')
  })

  it('shows a placeholder message instead of an empty list when the plan has no entitlements yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE }))

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('این پلن هنوز محدودیت یا امکان خاصی تعریف‌شده ندارد.')
  })

  it('renders a read-only billing history when periods exist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'period-1',
            periodStart: '2026-08-01T00:00:00.000Z',
            periodEnd: '2026-09-01T00:00:00.000Z',
            amountToman: 490000,
            discountPercent: null,
            status: 'paid',
          },
        ],
      })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPlan()

    const row = wrapper.get('[data-testid="billing-period-row"]')
    expect(row.text()).toContain('پرداخت‌شده')
  })

  it('shows no billing-history section at all when there are no periods yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPlan()

    expect(wrapper.find('[data-testid="billing-period-row"]').exists()).toBe(false)
  })

  it('explains a canceled subscription instead of silently showing the fallback plan as normal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...RESPONSE, subscription: { status: 'canceled' } }),
      }),
    )

    const wrapper = await mountPlan()

    expect(wrapper.find('[data-testid="canceled-note"]').exists()).toBe(true)
  })

  describe('usage meters and plan-change note', () => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    // Routed by URL: the meters load alongside the plan and billing history.
    function routed(overrides: { entitlements?: Record<string, unknown>; quota?: unknown; customersTotal?: number } = {}) {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/sms-quota')) return overrides.quota === undefined ? ok({ quota: 20, used: 5, remaining: 15 }) : ok(overrides.quota)
        if (url.includes('/billing-periods')) return ok([])
        if (url.includes('/salons/mine/customers')) return ok({ items: [], total: overrides.customersTotal ?? 0, page: 1, pageSize: 1 })
        return ok({ ...RESPONSE, resolvedEntitlements: overrides.entitlements ?? {} })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('meters SMS used against the monthly quota from /sms-quota, in Persian digits', async () => {
      routed()
      const wrapper = await mountPlan()

      const meter = wrapper.get('[data-testid="sms-usage-meter"]')
      expect(meter.get('[data-testid="usage-meter-value"]').text()).toBe('۵ از ۲۰ پیامک')
      const bar = meter.get('[role="meter"]')
      expect(bar.attributes('aria-valuenow')).toBe('5')
      expect(bar.attributes('aria-valuemax')).toBe('20')
      expect(meter.attributes('data-state')).toBe('ok')
    })

    it('marks the SMS meter full when the quota is used up', async () => {
      routed({ quota: { quota: 20, used: 20, remaining: 0 } })
      const wrapper = await mountPlan()

      const meter = wrapper.get('[data-testid="sms-usage-meter"]')
      expect(meter.attributes('data-state')).toBe('full')
      expect(meter.find('[data-testid="usage-meter-full"]').exists()).toBe(true)
    })

    it('meters CRM customers only when the plan caps them, and never fetches the count otherwise', async () => {
      const uncapped = routed()
      let wrapper = await mountPlan()
      expect(wrapper.find('[data-testid="crm-usage-meter"]').exists()).toBe(false)
      expect(uncapped.mock.calls.some((c) => String(c[0]).includes('/salons/mine/customers'))).toBe(false)
      wrapper.unmount()

      routed({ entitlements: { crmCustomerCap: 50 }, customersTotal: 42 })
      wrapper = await mountPlan()
      await new Promise((r) => setTimeout(r, 0))
      expect(wrapper.get('[data-testid="crm-usage-meter"] [data-testid="usage-meter-value"]').text()).toBe('۴۲ از ۵۰ مشتری')
      expect(wrapper.get('[data-testid="crm-usage-meter"]').attributes('data-state')).toBe('high')
    })

    it('says plan changes go through support, with no self-serve upgrade control', async () => {
      routed()
      const wrapper = await mountPlan()

      expect(wrapper.get('[data-testid="plan-change-note"]').text()).toContain('تغییر پلن با پشتیبانی')
      expect(wrapper.findAll('button')).toHaveLength(0)
    })
  })
})
