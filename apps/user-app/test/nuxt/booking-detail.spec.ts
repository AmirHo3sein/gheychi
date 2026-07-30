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

const MY_REVIEW = {
  id: 'rev-1',
  bookingId: 'b1',
  rating: 4,
  comment: 'خیلی خوب بود',
  workerRating: null as number | null,
  status: 'published',
  editableUntil: '2099-01-01T00:00:00.000Z',
  canEdit: true,
}

// The page fetches the booking and, for a completed one, the caller's own review of it.
function stub(booking: unknown, reviews: unknown[] = []) {
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/bookings/b1' && (!opts || opts.method === undefined || opts.method === 'GET')) return booking
    if (path === '/reviews/mine') return reviews
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('booking detail page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData(['booking-detail-b1', 'booking-review-b1'])
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
    stub({ ...BASE_BOOKING, status: 'completed', workerName: 'Sara' })
    wrapper = await mountSuspended(BookingDetailPage)
    const reviewButton = wrapper.find('[data-testid="review-booking-button"]')
    expect(reviewButton.exists()).toBe(true)
    expect(reviewButton.text()).toBe('ثبت نظر')
    expect(wrapper.find('[data-testid="cancel-booking-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(false)

    await reviewButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('این نوبت چطور بود؟')
  })

  // Regression: the action read "ثبت نظر" for an already-reviewed booking too, so the
  // only thing it could do was 409 -- leaving the shipped 72h edit/delete window
  // unreachable from this screen.
  it('offers ویرایش نظر for an already-reviewed booking and opens the modal pre-filled', async () => {
    stub({ ...BASE_BOOKING, status: 'completed' }, [MY_REVIEW])
    wrapper = await mountSuspended(BookingDetailPage)

    const reviewButton = wrapper.get('[data-testid="review-booking-button"]')
    expect(reviewButton.text()).toBe('ویرایش نظر')

    await reviewButton.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('این نوبت چطور بود؟')
    expect(wrapper.text()).toContain('خیلی خوب بود')
    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(true)
  })

  it('asks the API only for this booking\'s own review, not the caller\'s whole history', async () => {
    stub({ ...BASE_BOOKING, status: 'completed' }, [MY_REVIEW])
    wrapper = await mountSuspended(BookingDetailPage)

    expect(fetchMock).toHaveBeenCalledWith(
      '/reviews/mine',
      expect.objectContaining({ query: { bookingId: 'b1' } }),
    )
  })

  it('does not look up a review for a booking that cannot have one', async () => {
    stub({ ...BASE_BOOKING, status: 'confirmed' })
    wrapper = await mountSuspended(BookingDetailPage)

    expect(fetchMock).not.toHaveBeenCalledWith('/reviews/mine', expect.anything())
  })

  it('drops to مشاهده نظر once the edit window has closed', async () => {
    stub({ ...BASE_BOOKING, status: 'completed' }, [{ ...MY_REVIEW, canEdit: false, editableUntil: '2020-01-01T00:00:00.000Z' }])
    wrapper = await mountSuspended(BookingDetailPage)

    await wrapper.get('[data-testid="review-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="edit-window-closed"]').text()).toContain('مهلت ویرایش')
  })

  it('shows a note instead of a review action once the review has been withdrawn', async () => {
    stub({ ...BASE_BOOKING, status: 'completed' }, [{ ...MY_REVIEW, status: 'withdrawn', canEdit: false }])
    wrapper = await mountSuspended(BookingDetailPage)

    expect(wrapper.find('[data-testid="review-booking-button"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="review-withdrawn-note"]').text()).toContain('حذف شده')
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
