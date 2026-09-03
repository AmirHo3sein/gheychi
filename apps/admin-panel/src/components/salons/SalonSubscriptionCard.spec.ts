import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonSubscriptionCard from './SalonSubscriptionCard.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

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
    // The card fires a THIRD load call on mount (GET .../billing-periods) alongside the
    // subscription+plans pair every existing test below already queues with
    // mockResolvedValueOnce. Rather than touch every one of those tests, this low-priority
    // default implementation answers the billing-periods call once the once-queue in a given
    // test is exhausted -- vitest/jest consult mockResolvedValueOnce entries first, in order,
    // before falling back to mockImplementation.
    fetchMock.mockImplementation((url: string) =>
      url.includes('billing-periods') ? Promise.resolve({ data: [], error: null }) : Promise.resolve({ data: undefined, error: null }),
    )
  })

  function mountCard() {
    return mount(SalonSubscriptionCard, { props: { salonId: 's1' } })
  }

  it('loads and shows the current plan and status', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: subscriptionResponse(), error: null }) // GET subscription
      .mockResolvedValueOnce({ data: [FREE_PLAN, PLUS_PLAN], error: null }) // GET plans
      .mockResolvedValueOnce({ data: [], error: null }) // GET billing periods

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

  describe('billing periods', () => {
    // A factory, not a shared constant -- resolvePeriod() Object.assign()s the API response
    // onto the row in place, which would leak a 'paid' status into the next test.
    const pendingPeriod = () => ({
      id: 'period-1',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      baseAmountToman: 490000,
      discountPercent: null,
      amountToman: 490000,
      status: 'pending' as const,
      resolvedAt: null,
    })

    it('lists existing billing periods for this salon', async () => {
      fetchMock
        .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
        .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
        .mockResolvedValueOnce({ data: [pendingPeriod()], error: null })

      const wrapper = mountCard()
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/billing-periods', { silent: true })
      const row = wrapper.get('[data-testid="billing-period-row"]')
      expect(row.text()).toContain('در انتظار')
      expect(row.find('[data-testid="mark-paid-period-1"]').exists()).toBe(true)
    })

    it('creates a new billing period, optionally with a coupon code', async () => {
      fetchMock
        .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
        .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const wrapper = mountCard()
      await flushPromises()

      await wrapper.get('[data-testid="new-billing-period-button"]').trigger('click')
      // JalaliDatePicker isn't a native input -- drive its v-model contract directly, same
      // pattern as FeaturedView.spec.ts/AnalyticsView.spec.ts's own date-range filters.
      const [startPicker, endPicker] = wrapper.findAllComponents(JalaliDatePicker)
      await startPicker!.vm.$emit('update:modelValue', '2026-08-01')
      await endPicker!.vm.$emit('update:modelValue', '2026-09-01')
      await wrapper.get('[data-testid="new-period-coupon-input"]').setValue('plus20')

      fetchMock.mockResolvedValueOnce({ data: { ...pendingPeriod(), discountPercent: 20, amountToman: 392000 }, error: null })
      await wrapper.get('[data-testid="submit-new-billing-period"]').trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/billing-periods', {
        method: 'POST',
        body: {
          periodStart: new Date('2026-08-01T00:00:00.000').toISOString(),
          periodEnd: new Date('2026-09-01T00:00:00.000').toISOString(),
          couponCode: 'plus20',
        },
      })
      expect(wrapper.get('[data-testid="billing-period-row"]').text()).toContain('۲۰٪ تخفیف اعمال‌شده')
      expect(pushToastMock).toHaveBeenCalled()
    })

    it('marks a pending period paid through the confirm step and shows the updated status', async () => {
      fetchMock
        .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
        .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
        .mockResolvedValueOnce({ data: [pendingPeriod()], error: null })

      const wrapper = mountCard()
      await flushPromises()
      fetchMock.mockClear()

      // Settlement is settle-once on the backend, so the first click must only open the
      // confirm step -- never PATCH on its own.
      await wrapper.get('[data-testid="mark-paid-period-1"]').trigger('click')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="confirm-resolve-period-1"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="billing-period-row"]').text()).toContain('قابل بازگشت نیست')

      fetchMock.mockResolvedValueOnce({ data: { ...pendingPeriod(), status: 'paid', resolvedAt: '2026-08-30T00:00:00.000Z' }, error: null })
      await wrapper.get('[data-testid="confirm-resolve-period-1"]').trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/billing-periods/period-1/status', {
        method: 'PATCH',
        body: { status: 'paid' },
      })
      expect(wrapper.get('[data-testid="billing-period-row"]').text()).toContain('پرداخت‌شده')
      // A resolved period offers no further status-change actions.
      expect(wrapper.find('[data-testid="mark-paid-period-1"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="confirm-resolve-period-1"]').exists()).toBe(false)
    })

    it('voids a pending period through the confirm step, sending the status that was picked', async () => {
      fetchMock
        .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
        .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
        .mockResolvedValueOnce({ data: [pendingPeriod()], error: null })

      const wrapper = mountCard()
      await flushPromises()

      await wrapper.get('[data-testid="mark-void-period-1"]').trigger('click')
      fetchMock.mockResolvedValueOnce({ data: { ...pendingPeriod(), status: 'void', resolvedAt: '2026-08-30T00:00:00.000Z' }, error: null })
      await wrapper.get('[data-testid="confirm-resolve-period-1"]').trigger('click')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/subscription/billing-periods/period-1/status', {
        method: 'PATCH',
        body: { status: 'void' },
      })
      expect(wrapper.get('[data-testid="billing-period-row"]').text()).toContain('باطل‌شده')
    })

    it('cancelling the confirm step restores the three actions without calling the API', async () => {
      fetchMock
        .mockResolvedValueOnce({ data: subscriptionResponse(), error: null })
        .mockResolvedValueOnce({ data: [FREE_PLAN], error: null })
        .mockResolvedValueOnce({ data: [pendingPeriod()], error: null })

      const wrapper = mountCard()
      await flushPromises()
      fetchMock.mockClear()

      await wrapper.get('[data-testid="mark-comped-period-1"]').trigger('click')
      const cancel = wrapper.findAll('button').find((b) => b.text() === 'انصراف')
      await cancel!.trigger('click')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="confirm-resolve-period-1"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="mark-paid-period-1"]').exists()).toBe(true)
    })
  })
})
