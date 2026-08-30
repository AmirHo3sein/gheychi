import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonSubscriptionCard from './SalonSubscriptionCard.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

const fetchMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushToastMock, toasts: [] }),
}))

const FREE_PLAN = { id: 'plan-free', key: 'free', name: 'رایگان', monthlyPriceToman: 0, isActive: true }
const PLUS_PLAN = { id: 'plan-plus', key: 'plus', name: 'پلاس', monthlyPriceToman: 490000, isActive: true }

const subscriptionResponse = (overrides: Record<string, unknown> = {}) => ({
  subscription: {
    id: 'sub-1',
    planId: 'plan-free',
    status: 'active',
    startedAt: '2026-08-01T00:00:00.000Z',
    canceledAt: null,
    entitlementOverrides: null,
    ...overrides,
  },
  plan: FREE_PLAN,
  resolvedEntitlements: {},
})

describe('SalonSubscriptionCard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToastMock.mockReset()
  })

  function mountCard() {
    return mount(SalonSubscriptionCard, { props: { salonId: 's1' } })
  }

  it('loads and shows the current plan and status', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null }) // GET subscription
      .mockResolvedValueOnce({ data: [FREE_PLAN, PLUS_PLAN], error: null }) // GET plans

    const wrapper = mountCard()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription', { silent: true })
    expect(wrapper.text()).toContain('رایگان')
    expect(wrapper.get('[data-testid="subscription-status"]').text()).toBe('فعال')
  })

  it('shows a retryable error state when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    fetchMock.mockResolvedValueOnce({ data: [], error: null })

    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.find('[data-testid="subscription-error"]').exists()).toBe(true)

    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
      .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
    await wrapper.get('[data-testid="subscription-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="subscription-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('رایگان')
  })

  it('changes the plan through the confirm step and refreshes from the response', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
      .mockResolvedValueOnce({ data: [FREE_PLAN, PLUS_PLAN], error: null })

    const wrapper = mountCard()
    await flushPromises()

    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'plan-plus')
    await wrapper.get('[data-testid="change-plan-button"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-plan-change"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({
      data: { ...subscriptionResponse({ planId: 'plan-plus' }), plan: PLUS_PLAN },
      error: null,
    })
    await wrapper.get('[data-testid="confirm-plan-change"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription', {
      method: 'PATCH',
      body: { planId: 'plan-plus' },
    })
    expect(wrapper.text()).toContain('پلاس')
    expect(pushToastMock).toHaveBeenCalled()
  })

  it('cancels the subscription through the confirm step', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
      .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })

    const wrapper = mountCard()
    await flushPromises()

    await wrapper.get('[data-testid="cancel-subscription-button"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-cancel-subscription"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({
      data: subscriptionResponse({ status: 'canceled', canceledAt: '2026-08-30T00:00:00.000Z' }),
      error: null,
    })
    await wrapper.get('[data-testid="confirm-cancel-subscription"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/cancel', { method: 'POST' })
    expect(wrapper.get('[data-testid="subscription-status"]').text()).toBe('لغوشده')
  })

  it('sets a salon-specific entitlement override from JSON text', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
      .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })

    const wrapper = mountCard()
    await flushPromises()

    await wrapper.get('[data-testid="edit-overrides-button"]').trigger('click')
    await wrapper.get('[data-testid="overrides-input"]').setValue('{"smsMonthlyQuota": 500}')

    fetchMock.mockResolvedValueOnce({
      data: {
        ...subscriptionResponse({ entitlementOverrides: { smsMonthlyQuota: 500 } }),
        resolvedEntitlements: { smsMonthlyQuota: 500 },
      },
      error: null,
    })
    await wrapper.get('[data-testid="save-overrides-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/overrides', {
      method: 'PATCH',
      body: { overrides: { smsMonthlyQuota: 500 } },
    })
    expect(wrapper.find('[data-testid="has-overrides-note"]').exists()).toBe(true)
  })

  it('rejects invalid JSON in the overrides editor without calling the API', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
      .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })

    const wrapper = mountCard()
    await flushPromises()

    await wrapper.get('[data-testid="edit-overrides-button"]').trigger('click')
    await wrapper.get('[data-testid="overrides-input"]').setValue('{not valid json')
    fetchMock.mockClear()
    await wrapper.get('[data-testid="save-overrides-button"]').trigger('click')

    expect(wrapper.find('[data-testid="overrides-error"]').exists()).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
