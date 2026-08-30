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
        json: async () => ({ ...RESPONSE, resolvedEntitlements: { smsMonthlyQuota: 100, crmCustomerCap: 50 } }),
      }),
    )

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('smsMonthlyQuota')
    expect(wrapper.text()).toContain('100')
    expect(wrapper.text()).toContain('crmCustomerCap')
  })

  it('shows a placeholder message instead of an empty list when the plan has no entitlements yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => RESPONSE }))

    const wrapper = await mountPlan()

    expect(wrapper.text()).toContain('این پلن هنوز محدودیت یا امکان خاصی تعریف‌شده ندارد.')
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
})
