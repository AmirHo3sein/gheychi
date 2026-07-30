import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import CallbackPage from '../../app/pages/booking/callback.vue'

const { useRouteMock } = vi.hoisted(() => ({ useRouteMock: vi.fn() }))
mockNuxtImport('useRoute', () => useRouteMock)

function mountWithQuery(query: Record<string, string | undefined>) {
  useRouteMock.mockReturnValue({ query })
  return mountSuspended(CallbackPage)
}

describe('booking callback page', () => {
  beforeEach(() => {
    useRouteMock.mockReset()
  })

  it('shows a success message and a link to the booking detail when status=success', async () => {
    const wrapper = await mountWithQuery({ status: 'success', bookingId: 'b1' })

    expect(wrapper.find('[data-testid="callback-title"]').text()).toBe('پرداخت با موفقیت انجام شد')
    expect(wrapper.html()).not.toMatch(/[\u{1F300}-\u{1FAFF}✀-➿]/u) // no emoji, icons only
    expect(wrapper.find('svg').exists()).toBe(true)

    const viewBookingLink = wrapper.find('[data-testid="view-booking-button"]')
    expect(viewBookingLink.exists()).toBe(true)
  })

  it('shows a failure message and omits the booking-detail action when status is not success', async () => {
    const wrapper = await mountWithQuery({ status: 'failed', bookingId: undefined })

    expect(wrapper.find('[data-testid="callback-title"]').text()).toBe('پرداخت ناموفق بود')
    expect(wrapper.find('[data-testid="view-booking-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="my-bookings-button"]').exists()).toBe(true)
  })

  // The late-capture case: the deposit WAS captured, but the booking had already left
  // pending_payment, so PaymentsService queues a real refund instead of resurrecting a
  // released slot. This customer used to get the plain failure page -- told "no payment
  // happened and nothing was reserved" while their money was gone, which is exactly the
  // message that makes someone call support or pay a second time.
  it('tells a customer whose money WAS captured that the refund is already under way', async () => {
    const wrapper = await mountWithQuery({ status: 'refunding', bookingId: 'b1' })
    const text = wrapper.text()

    // Never the "you were not charged / nothing was reserved" lie.
    expect(text).not.toContain('پرداخت ناموفق بود')
    expect(text).not.toContain('پرداخت انجام نشد')
    expect(text).not.toContain('نوبتی برای شما رزرو نشده است')
    // The money is acknowledged as received, the booking as not held.
    expect(wrapper.find('[data-testid="callback-title"]').text()).toBe('پرداخت شما دریافت شد، اما نوبت ثبت نشد')
    // Same vocabulary bookings/[id].vue uses for refundStatus: 'pending'.
    expect(text).toContain('بازگشت وجه به‌صورت خودکار در حال انجام است')
    expect(text).toContain('نیازی به اقدام شما نیست')
    // Neutral, not danger -- this is an in-progress fact, not an error to act on.
    expect(wrapper.html()).toContain('--color-text-muted')
    expect(wrapper.html()).not.toContain('--color-danger')
  })

  // Anything the API sends that isn't recognised must keep falling back to the plain failure
  // page -- a refund-shaped state is only ever claimed when the API actually says so.
  it('falls back to the failure state for an unrecognised status', async () => {
    const wrapper = await mountWithQuery({ status: 'something-else', bookingId: undefined })

    expect(wrapper.find('[data-testid="callback-title"]').text()).toBe('پرداخت ناموفق بود')
  })
})
