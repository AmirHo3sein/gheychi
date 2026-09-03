import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import BookingsListPage from '../../app/pages/bookings/index.vue'

// Same pattern as booking-confirm.spec.ts / ReportForm.spec.ts: `$fetch` is a real
// globalThis binding, not an unimport-tracked auto-import, so it's stubbed directly.
// This page loads via onMounted (not a top-level useAsyncData await), so every test
// mounts then awaits flushPromises() before asserting.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const TERMS = { depositPercent: 20, depositMinToman: 200_000, cancellationWindowHours: 48 }

const PENDING_BOOKING = {
  id: 'b-pending',
  salonName: 'سالن الف',
  serviceName: 'کوتاهی مو',
  workerName: null,
  startsAt: '2099-01-01T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 60_000,
  status: 'pending_payment' as const,
}

const CONFIRMED_FAR_BOOKING = {
  id: 'b-confirmed-far',
  salonName: 'سالن ب',
  serviceName: 'رنگ مو',
  workerName: 'سارا',
  // Far enough in the future that it's outside the 48h cancellation window relative to "now".
  startsAt: '2099-06-01T09:00:00.000Z',
  priceSnapshot: 500_000,
  depositAmount: 100_000,
  status: 'confirmed' as const,
  paymentExpiresAt: null,
  // Real money was captured for this booking (the API derives this from the Payment row),
  // which is what the cancel dialog's refund copy keys off. See the page's own hasOnlineDeposit.
  depositPaid: true,
}

// Confirmed with the platform's online-payment flag off: the API recorded depositAmount for
// reporting but never collected it, so no money ever moved.
const CONFIRMED_UNPAID_BOOKING = {
  ...CONFIRMED_FAR_BOOKING,
  id: 'b-confirmed-unpaid',
  depositPaid: false,
}

const COMPLETED_BOOKING = {
  id: 'b-completed',
  salonName: 'سالن ج',
  serviceName: 'اصلاح ابرو',
  workerName: null,
  startsAt: '2020-01-01T09:00:00.000Z',
  priceSnapshot: 150_000,
  depositAmount: 50_000,
  status: 'completed' as const,
}

// Manual-approval mode: a request the salon hasn't answered yet. No payment exists for it,
// which is the single fact every assertion below is really protecting. The deadline is
// expressed relative to the real clock so the countdown assertions don't depend on when the
// suite runs -- formatRemainingTime's own exact output is pinned in test/unit.
const PENDING_APPROVAL_BOOKING = {
  id: 'b-pending-approval',
  salonName: 'سالن ه',
  serviceName: 'کوتاهی مو',
  workerName: null,
  startsAt: '2099-03-01T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 60_000,
  status: 'pending_approval' as const,
  confirmationMode: 'manual_approval' as const,
  approvalExpiresAt: new Date(Date.now() + 45 * 60_000).toISOString(),
  paymentExpiresAt: null,
}

const REJECTED_BOOKING = {
  id: 'b-rejected',
  salonName: 'سالن و',
  serviceName: 'رنگ مو',
  workerName: null,
  startsAt: '2099-03-02T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 60_000,
  status: 'rejected_by_salon' as const,
  confirmationMode: 'manual_approval' as const,
  approvalExpiresAt: null,
  paymentExpiresAt: null,
}

const CANCELLED_BOOKING = {
  id: 'b-cancelled',
  salonName: 'سالن د',
  serviceName: 'میکاپ',
  workerName: null,
  startsAt: '2020-01-01T09:00:00.000Z',
  priceSnapshot: 400_000,
  depositAmount: 80_000,
  status: 'cancelled_by_user' as const,
}

// The caller's own review of COMPLETED_BOOKING, still inside the edit window.
const MY_REVIEW = {
  id: 'rev-1',
  bookingId: 'b-completed',
  rating: 4,
  comment: 'خیلی خوب بود',
  workerRating: null,
  status: 'published' as const,
  editableUntil: '2099-01-01T00:00:00.000Z',
  canEdit: true,
}

function stub(bookings: unknown[], terms: unknown = TERMS, reviews: unknown[] = []) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/bookings/mine') return bookings
    if (path === '/platform-config/booking-terms') return terms
    if (path === '/reviews/mine') return reviews
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('bookings list page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links every booking card to its detail page', async () => {
    stub([PENDING_BOOKING, COMPLETED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const links = wrapper.findAll('[data-testid="booking-detail-link"]')
    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('href')).toBe('/bookings/b-pending')
    expect(links[1]!.attributes('href')).toBe('/bookings/b-completed')
  })

  it('renders a distinct status badge per booking status', async () => {
    stub([PENDING_BOOKING, COMPLETED_BOOKING, CANCELLED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const badges = wrapper.findAll('[data-testid="booking-status-badge"]')
    expect(badges).toHaveLength(3)

    expect(badges[0]!.text()).toContain('در انتظار پرداخت')
    expect(badges[0]!.classes()).toContain('text-(--color-text)')

    expect(badges[1]!.text()).toContain('انجام شده')
    expect(badges[1]!.classes()).toContain('text-(--color-success)')

    expect(badges[2]!.text()).toContain('لغو شده توسط شما')
    expect(badges[2]!.classes()).toContain('text-(--color-danger)')
  })

  it('never reaches for --color-ad on this page', async () => {
    stub([PENDING_BOOKING, CONFIRMED_FAR_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.html()).not.toContain('--color-ad')
  })

  it('shows a free-cancel refund outcome for a confirmed booking outside the cancellation window', async () => {
    stub([CONFIRMED_FAR_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="cancel-confirm-dialog"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()).toContain('بازگردانده می‌شود')
  })

  it('shows a no-refund outcome for a confirmed booking inside the cancellation window', async () => {
    const soonBooking = { ...CONFIRMED_FAR_BOOKING, id: 'b-confirmed-soon', startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
    stub([soonBooking])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()).toContain('قابل بازگشت نیست')
  })

  // The dialog used to promise "your deposit will be refunded in full" for every confirmed
  // booking -- including ones made while online payment collection was off, where no
  // deposit was ever taken.
  it('does not promise a refund for a confirmed booking that never had a deposit collected', async () => {
    stub([CONFIRMED_UNPAID_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    const copy = wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()
    expect(copy).toContain('پیش‌پرداختی دریافت نشده است')
    expect(copy).not.toContain('بازگردانده می‌شود')
    expect(copy).not.toContain('قابل بازگشت نیست')
  })

  // The seeded cancellation_window_hours is 24 (initial-schema migration); the fallback
  // used to say 48, quietly promising a longer free-cancel window than the API enforces.
  it('falls back to the seeded 24h window when booking-terms did not load', async () => {
    stub([CONFIRMED_FAR_BOOKING], null)
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    const copy = wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()
    expect(copy).toContain('۲۴ ساعت')
    expect(copy).not.toContain('۴۸')
  })

  it('shows a no-cost cancellation outcome for a pending_payment booking regardless of the window', async () => {
    stub([PENDING_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()).toContain('هزینه‌ای برای شما ندارد')
  })

  it('cancels the booking and closes the dialog on confirm', async () => {
    stub([CONFIRMED_FAR_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()

    fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/bookings/b-confirmed-far/cancel' && opts?.method === 'POST') return {}
      if (path === '/bookings/mine') return []
      if (path === '/platform-config/booking-terms') return TERMS
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="cancel-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/bookings/b-confirmed-far/cancel', expect.objectContaining({ method: 'POST' }))
    expect(wrapper.find('[data-testid="cancel-confirm-dialog"]').exists()).toBe(false)
  })

  it('dismisses the dialog without cancelling', async () => {
    stub([CONFIRMED_FAR_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cancel-confirm-dismiss"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="cancel-confirm-dialog"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalledWith('/bookings/b-confirmed-far/cancel', expect.anything())
  })

  it('offers ثبت نظر for a completed booking the caller has not reviewed yet', async () => {
    stub([COMPLETED_BOOKING], TERMS, [])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="review-booking-button"]').text()).toBe('ثبت نظر')
  })

  // Regression: the button used to read "ثبت نظر" no matter what, so a returning user
  // re-submitted, hit the 409, and landed in a dead-end panel with no way to reach the
  // edit/delete window the API actually still allowed.
  it('offers ویرایش نظر for an already-reviewed booking and opens the modal pre-filled', async () => {
    stub([COMPLETED_BOOKING], TERMS, [MY_REVIEW])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const button = wrapper.get('[data-testid="review-booking-button"]')
    expect(button.text()).toBe('ویرایش نظر')

    await button.trigger('click')
    await flushPromises()

    // Opens straight into the read/edit view of the existing review, not a blank form.
    expect(wrapper.text()).not.toContain('این نوبت چطور بود؟')
    expect(wrapper.text()).toContain('خیلی خوب بود')
    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="delete-review-button"]').exists()).toBe(true)
  })

  it('drops to مشاهده نظر, with no edit/delete controls, once the edit window has closed', async () => {
    stub([COMPLETED_BOOKING], TERMS, [{ ...MY_REVIEW, canEdit: false, editableUntil: '2020-01-01T00:00:00.000Z' }])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const button = wrapper.get('[data-testid="review-booking-button"]')
    expect(button.text()).toBe('مشاهده نظر')

    await button.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="edit-review-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delete-review-button"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="edit-window-closed"]').text()).toContain('مهلت ویرایش')
  })

  // A booking whose review was deleted stays permanently un-reviewable (the DB unique
  // index is on booking_id regardless of status), so offering any action would only 409.
  it('shows a note instead of a review action once the review has been withdrawn', async () => {
    stub([COMPLETED_BOOKING], TERMS, [{ ...MY_REVIEW, status: 'withdrawn', canEdit: false }])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="review-booking-button"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="review-withdrawn-note"]').text()).toContain('حذف شده')
  })

  it('refreshes the review snapshot after one is submitted from the modal', async () => {
    stub([COMPLETED_BOOKING], TERMS, [])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="review-booking-button"]').trigger('click')
    await flushPromises()

    let reviews: unknown[] = []
    fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/reviews' && opts?.method === 'POST') {
        reviews = [MY_REVIEW]
        return { id: 'rev-1', rating: 5, comment: null }
      }
      if (path === '/reviews/mine') return reviews
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="submit-review-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/reviews/mine', expect.anything())
    expect(wrapper.get('[data-testid="review-booking-button"]').text()).toBe('ویرایش نظر')
  })

  // STATUS_META is a CLOSED Record indexed directly in the template, so a status with no
  // entry doesn't degrade -- it throws inside the render function and takes the whole list
  // down, including every other booking on it. This is the regression guard for the two
  // members the manual-approval workflow added.
  it('renders the manual-approval statuses instead of crashing the whole list on an unmapped status', async () => {
    stub([PENDING_APPROVAL_BOOKING, REJECTED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const badges = wrapper.findAll('[data-testid="booking-status-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0]!.text()).toContain('در انتظار تایید سالن')
    expect(badges[1]!.text()).toContain('رد شده توسط سالن')
    expect(badges[1]!.classes()).toContain('text-(--color-danger)')
  })

  // The load-bearing test of this whole feature on the list: a pending_approval booking has
  // no payment behind it, so offering to "complete" one would both fail server-side and tell
  // the customer they owe money on an appointment they don't have yet.
  it('never offers a payment action for a booking still awaiting the salon', async () => {
    stub([PENDING_APPROVAL_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(false)
    const strip = wrapper.get('[data-testid="pending-approval-strip"]')
    expect(strip.text()).toContain('در انتظار تایید سالن')
    expect(strip.text()).toContain('هنوز مبلغی پرداخت نشده است')
    expect(strip.get('[data-testid="remaining-time"]').text()).toContain('مانده')
  })

  it('lets the customer withdraw a request the salon has not answered, at no cost', async () => {
    stub([PENDING_APPROVAL_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const cancelButton = wrapper.get('[data-testid="cancel-booking-button"]')
    // "لغو نوبت" would claim an appointment exists -- there isn't one until the salon says so.
    expect(cancelButton.text()).toBe('لغو درخواست')

    await cancelButton.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="cancel-confirm-refund-copy"]').text()).toContain('مبلغی از شما دریافت نشده است')
    expect(wrapper.get('[data-testid="cancel-confirm-submit"]').text()).toBe('لغو درخواست')
  })

  it('shows how long is left to pay on an approved-but-unpaid booking', async () => {
    stub([{ ...PENDING_BOOKING, paymentExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString() }])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.text()).toContain('مهلت پرداخت')
    expect(wrapper.get('[data-testid="remaining-time"]').text()).toContain('مانده')
    // The countdown is decoration on the action, never a gate on it.
    expect(wrapper.find('[data-testid="retry-payment-button"]').exists()).toBe(true)
  })

  it('shows an empty state when there are no bookings', async () => {
    stub([])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="bookings-empty"]').exists()).toBe(true)
  })

  // A failed list fetch used to render as "نوبتی ثبت نشده است" -- a claim about the
  // customer's bookings that a network blip has no business making.
  it('shows a retry state, not the empty state, when the bookings list fails to load', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/bookings/mine') throw { response: { status: 500 } }
      if (path === '/platform-config/booking-terms') return TERMS
      if (path === '/reviews/mine') return []
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="bookings-empty"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="bookings-load-error"]').attributes('role')).toBe('alert')

    stub([CONFIRMED_FAR_BOOKING])
    await wrapper.get('[data-testid="bookings-retry-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="bookings-load-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="booking-card"]')).toHaveLength(1)
  })
})
