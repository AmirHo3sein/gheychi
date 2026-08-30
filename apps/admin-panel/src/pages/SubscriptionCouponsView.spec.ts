import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SubscriptionCouponsView from './SubscriptionCouponsView.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

const fetchMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushToastMock, toasts: [] }),
}))

// A factory, not a shared constant -- the deactivate flow mutates the returned row's
// isActive in place.
function plus20Coupon() {
  return { id: 'coupon-1', code: 'PLUS20', discountPercent: 20, expiresAt: null, maxRedemptions: null, isActive: true }
}

describe('SubscriptionCouponsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToastMock.mockReset()
  })

  async function mountView() {
    const wrapper = mount(SubscriptionCouponsView)
    await flushPromises()
    return wrapper
  }

  it('lists subscription coupons with their discount, expiry, and cap', async () => {
    fetchMock.mockResolvedValueOnce({ data: [plus20Coupon()], error: null })
    const wrapper = await mountView()

    const card = wrapper.get('[data-testid="subscription-coupon-card"]')
    expect(card.text()).toContain('PLUS20')
    expect(card.text()).toContain('۲۰٪ تخفیف')
    expect(card.text()).toContain('نامحدود')
  })

  it('shows a retryable error state when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="coupons-load-error"]').exists()).toBe(true)
  })

  it('shows an empty state when there are no subscription coupons yet', async () => {
    fetchMock.mockResolvedValueOnce({ data: [], error: null })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('هنوز کد تخفیف اشتراکی ثبت نشده است.')
  })

  it('creates a coupon, normalizing the code to uppercase, and prepends it to the list', async () => {
    fetchMock.mockResolvedValueOnce({ data: [], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="new-code-input"]').setValue('plus20')
    await wrapper.get('[data-testid="new-discount-input"]').setValue('20')
    const [picker] = wrapper.findAllComponents(JalaliDatePicker)
    await picker!.vm.$emit('update:modelValue', '2026-12-31')
    await wrapper.get('[data-testid="new-max-redemptions-input"]').setValue('10')

    fetchMock.mockResolvedValueOnce({ data: plus20Coupon(), error: null })
    // Clicking a type="submit" button does not trigger form submission under jsdom --
    // trigger the form's own submit event instead, matching this codebase's own convention
    // (PlansView.spec.ts, LoginView.spec.ts, BlogPostsView.spec.ts).
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/subscription-coupons', {
      method: 'POST',
      body: {
        code: 'PLUS20',
        discountPercent: 20,
        expiresAt: new Date('2026-12-31T23:59:59.999').toISOString(),
        maxRedemptions: 10,
      },
    })
    expect(wrapper.get('[data-testid="subscription-coupon-card"]').text()).toContain('PLUS20')
    expect(pushToastMock).toHaveBeenCalled()
  })

  it('deactivates a coupon through the confirm step', async () => {
    fetchMock.mockResolvedValueOnce({ data: [plus20Coupon()], error: null })
    const wrapper = await mountView()

    await wrapper.get('[data-testid="deactivate-PLUS20"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-deactivate-PLUS20"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: null, error: null })
    await wrapper.get('[data-testid="confirm-deactivate-PLUS20"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/subscription-coupons/coupon-1', { method: 'DELETE' })
    expect(wrapper.get('[data-testid="subscription-coupon-card"]').text()).toContain('غیرفعال')
    expect(wrapper.find('[data-testid="deactivate-PLUS20"]').exists()).toBe(false)
  })
})
