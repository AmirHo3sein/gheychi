import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import BookingDetailPage from '../../app/pages/bookings/[id].vue'

// Same pattern as booking-confirm.spec.ts: `$fetch` is a real globalThis binding,
// not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { id: 'b1' } }))

const BASE_BOOKING = {
  id: 'b1',
  salonName: 'Test Salon',
  serviceName: 'Haircut',
  workerName: null as string | null,
  startsAt: '2026-07-20T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 200_000,
  status: 'cancelled_by_salon',
  refundStatus: null as string | null,
}

describe('booking detail page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('booking-detail-b1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression test for the documented Suspense pre-render-pass crash (see salons/[slug].vue
  // and booking/[slug]/[serviceId].vue, which this page's guard mirrors): without the root
  // `v-if="booking"` guard, Vue still runs one render pass with `booking` at its pre-fetch
  // (undefined) value before the createError(404) rejection is handled, and the template's
  // `booking!.salonName` access throws inside the render function itself -- an unhandled
  // render error, not a clean 404. Asserting the rejection's shape specifically discriminates
  // between the two: a real createError(404) rejection has `statusCode: 404`; an unguarded
  // render crash would reject with a bare TypeError that has no `statusCode` at all.
  it('rejects cleanly with a 404 for a missing/expired booking id, with no unhandled render error', async () => {
    fetchMock.mockResolvedValue(null)
    await expect(mountSuspended(BookingDetailPage)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('shows the in-progress line, muted (not alarming), while the refund is pending', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'pending' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('بازگشت وجه در حال انجام است')
    const line = wrapper.find('[data-testid="refund-status-card"]')
    expect(line.html()).toContain('text-(--color-text-muted)')
    expect(line.html()).not.toContain('text-(--color-accent)')
    expect(line.html()).not.toContain('text-(--color-success)')
  })

  it('shows the completed line, in success color, once the refund is done', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'done' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('وجه بازگردانده شد')
    expect(wrapper.text()).not.toContain('در حال انجام')
    const line = wrapper.find('[data-testid="refund-status-card"]')
    expect(line.html()).toContain('text-(--color-success)')
    expect(line.html()).not.toContain('text-(--color-accent)')
  })

  it('shows no refund card when there is no refund in play', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: null })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).not.toContain('بازگشت وجه')
    expect(wrapper.text()).not.toContain('بازگردانده')
    expect(wrapper.find('[data-testid="refund-status-card"]').exists()).toBe(false)
  })

  it('never uses plain --color-accent as body text anywhere on the page (WCAG AA contrast fix)', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'pending' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('بازگشت به نوبت‌های من')
    // `text-(--color-accent-strong)` is a different, WCAG-AA-compliant token and must not
    // false-positive here -- this checks for the exact plain-accent class, not a substring
    // match that a "-strong)" suffix would also satisfy.
    expect(wrapper.html()).not.toContain('text-(--color-accent)')
  })

  it('shows a retry-payment action for a pending_payment booking', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, status: 'pending_payment' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cancel-booking-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-booking-button"]').exists()).toBe(false)
  })

  it('shows a cancel action for a confirmed booking and no retry/review actions', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, status: 'confirmed' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.find('[data-testid="cancel-booking-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-booking-button"]').exists()).toBe(false)
  })

  it('shows a review action for a completed booking, opening the review prompt on click', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, status: 'completed', workerName: 'Sara' })
    wrapper = await mountSuspended(BookingDetailPage)
    const reviewButton = wrapper.find('[data-testid="review-booking-button"]')
    expect(reviewButton.exists()).toBe(true)
    expect(wrapper.find('[data-testid="cancel-booking-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(false)

    await reviewButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('این نوبت چطور بود؟')
  })

  it('shows no action buttons for a booking in a terminal, non-actionable state', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, status: 'cancelled_by_salon' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cancel-booking-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="review-booking-button"]').exists()).toBe(false)
  })

  it('cancels the booking and refreshes after confirmation', async () => {
    vi.stubGlobal('confirm', () => true)
    fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/bookings/b1' && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return { ...BASE_BOOKING, status: 'confirmed' }
      }
      if (path === '/bookings/b1/cancel' && opts?.method === 'POST') return { ok: true }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BookingDetailPage)

    await wrapper.find('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/bookings/b1/cancel', expect.objectContaining({ method: 'POST' }))
  })

  it('does not cancel when the confirm dialog is dismissed', async () => {
    vi.stubGlobal('confirm', () => false)
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, status: 'confirmed' })
    wrapper = await mountSuspended(BookingDetailPage)

    await wrapper.find('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith('/bookings/b1/cancel', expect.anything())
  })
})
