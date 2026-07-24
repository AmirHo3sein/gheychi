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
})
