import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import BookingsListPage from '../../app/pages/bookings/index.vue'
import { useToast } from '../../app/composables/useToast'

// Same pattern as bookings-list.spec.ts / booking-confirm.spec.ts: `$fetch` is a real
// globalThis binding, not an unimport-tracked auto-import, so it's stubbed directly. This
// page loads via onMounted (not a top-level useAsyncData await), so every test mounts then
// awaits flushPromises() before asserting.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const TERMS = { depositPercent: 20, depositMinToman: 200_000, cancellationWindowHours: 48 }

// confirmed is a movable status (SLOT_BLOCKING_STATUSES on the API side) -- salonId/
// serviceId/workerId are real Booking-entity columns /bookings/mine always returns, just
// not previously read by this page.
const CONFIRMED_BOOKING = {
  id: 'b1',
  salonName: 'سالن الف',
  serviceName: 'کوتاهی مو',
  workerName: null,
  startsAt: '2099-01-01T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 60_000,
  status: 'confirmed' as const,
  paymentExpiresAt: null,
  depositPaid: true,
  salonId: 'salon-1',
  serviceId: 'service-1',
  workerId: null,
}

// completed already happened -- not in SLOT_BLOCKING_STATUSES, so it must never offer to move.
const COMPLETED_BOOKING = {
  id: 'b2',
  salonName: 'سالن ب',
  serviceName: 'رنگ مو',
  workerName: null,
  startsAt: '2020-01-01T09:00:00.000Z',
  priceSnapshot: 150_000,
  depositAmount: 50_000,
  status: 'completed' as const,
  salonId: 'salon-2',
  serviceId: 'service-2',
  workerId: null,
}

const NEW_SLOT_ISO = '2099-01-02T09:00:00.000Z'
const AVAILABILITY = [{ date: '2099-01-02', slots: [NEW_SLOT_ISO] }]

// Shape matches how ofetch surfaces an HTTP error response -- same helper booking-confirm.
// spec.ts uses: the status hangs off `response`, the API's own JSON body off `data`.
function apiError(status: number, message: string) {
  return { rejectWith: { response: { status }, data: { message } } }
}

function stub(
  bookings: unknown[],
  opts: { availability?: unknown[]; rescheduleBehavior?: 'success' | { rejectWith: unknown } } = {},
) {
  const availability = opts.availability ?? AVAILABILITY
  fetchMock.mockImplementation(async (path: string, fetchOpts?: { method?: string }) => {
    if (path === '/bookings/mine') return bookings
    if (path === '/platform-config/booking-terms') return TERMS
    if (path === '/reviews/mine') return []
    if (path === '/salons/salon-1/availability') return availability
    if (path === '/bookings/b1/reschedule' && fetchOpts?.method === 'POST') {
      if (!opts.rescheduleBehavior || opts.rescheduleBehavior === 'success') return {}
      throw opts.rescheduleBehavior.rejectWith
    }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

async function openDialogAndPickSlot(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.get('[data-testid="reschedule-booking-button"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="slot-button"]').trigger('click')
  await flushPromises()
}

describe('bookings list reschedule', () => {
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

  it('offers the reschedule button only for a movable-status booking', async () => {
    stub([CONFIRMED_BOOKING, COMPLETED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="reschedule-booking-button"]')).toHaveLength(1)
  })

  it('opens the picker, showing the booking\'s current time before it', async () => {
    stub([CONFIRMED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="reschedule-booking-button"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-testid="reschedule-dialog"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(wrapper.get('[data-testid="reschedule-current-time"]').text()).toContain(
      new Date(CONFIRMED_BOOKING.startsAt).toLocaleString('fa-IR'),
    )
    // Nothing picked yet -- submitting a booking with no chosen slot makes no sense.
    expect((wrapper.get('[data-testid="reschedule-submit"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits the newly picked slot and refreshes the list on success', async () => {
    stub([CONFIRMED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await openDialogAndPickSlot(wrapper)

    // The refetch that follows a successful reschedule sees the booking already moved.
    stub([{ ...CONFIRMED_BOOKING, startsAt: NEW_SLOT_ISO }])

    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/bookings/b1/reschedule',
      expect.objectContaining({ method: 'POST', body: { startsAt: NEW_SLOT_ISO } }),
    )
    // Dialog closed and the list reflects the moved time -- no full page reload needed.
    expect(wrapper.find('[data-testid="reschedule-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="booking-card"]').text()).toContain(new Date(NEW_SLOT_ISO).toLocaleString('fa-IR'))
  })

  it('shows the API\'s own conflict message on a 409 and keeps the dialog open for a retry', async () => {
    const message = 'تغییر زمان نوبت تا ۴۸ ساعت پیش از شروع ممکن است؛ برای تغییر با سالن تماس بگیرید'
    stub([CONFIRMED_BOOKING], { rescheduleBehavior: apiError(409, message) })
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await openDialogAndPickSlot(wrapper)

    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await flushPromises()

    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe(message)
    // The booking wasn't the problem, just the requested time -- the dialog stays open so
    // the customer can immediately pick a different one instead of re-opening it.
    expect(wrapper.find('[data-testid="reschedule-dialog"]').exists()).toBe(true)
  })

  it('shows the API\'s own message on a 400 (e.g. the booking is no longer movable)', async () => {
    const message = 'این نوبت در وضعیتی نیست که قابل جابه‌جایی باشد'
    stub([CONFIRMED_BOOKING], { rescheduleBehavior: apiError(400, message) })
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await openDialogAndPickSlot(wrapper)

    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await flushPromises()

    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe(message)
  })

  it('dismisses the dialog without rescheduling', async () => {
    stub([CONFIRMED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="reschedule-booking-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="reschedule-dismiss"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="reschedule-dialog"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalledWith('/bookings/b1/reschedule', expect.anything())
  })

  it('guards against a double submit while a reschedule write is already in flight', async () => {
    stub([CONFIRMED_BOOKING])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await openDialogAndPickSlot(wrapper)

    // openDialogAndPickSlot itself drives real fetch calls (SlotPicker's own availability
    // GETs) -- clear those out of the mock's call log before counting submits below, or
    // this assertion is really counting "how many fetches has this test made so far",
    // not "how many times did the submit handler actually fire".
    fetchMock.mockClear()

    // The reschedule POST itself never settles -- the window in which a second click could
    // otherwise double-fire.
    fetchMock.mockImplementation(async (path: string, fetchOpts?: { method?: string }) => {
      if (path === '/bookings/b1/reschedule' && fetchOpts?.method === 'POST') return new Promise(() => {})
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Same button, clicked again while still loading/disabled -- must stay a no-op.
    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
