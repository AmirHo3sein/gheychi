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

function stub(bookings: unknown[], terms: unknown = TERMS) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/bookings/mine') return bookings
    if (path === '/platform-config/booking-terms') return terms
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

  it('shows an empty state when there are no bookings', async () => {
    stub([])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="bookings-empty"]').exists()).toBe(true)
  })
})
