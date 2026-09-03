import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import { resetToast, useToast } from '@/composables/useToast'
import BookingsView from './BookingsView.vue'

// A manual-approval request exactly as GET /salons/mine/bookings returns one: nothing is
// paid yet (paymentExpiresAt is still null) and approvalExpiresAt is the server's own
// deadline snapshot. Far-future so the rendered countdown is stable whenever this runs.
const PENDING_REQUEST = {
  id: 'req1', serviceId: 's1', serviceName: 'رنگ مو', priceSnapshot: 400000,
  startsAt: '2030-06-15T09:00:00.000Z', endsAt: '2030-06-15T10:00:00.000Z',
  createdAt: '2030-06-14T09:00:00.000Z', status: 'pending_approval',
  confirmationMode: 'manual_approval', approvalExpiresAt: '2030-06-14T21:00:00.000Z',
  paymentExpiresAt: null, workerId: null, workerName: null,
  customerName: 'مریم احمدی', customerPhone: '09120000000', source: 'online',
}

// This view now owns a polling interval and a document-level visibilitychange listener, so
// a wrapper left mounted at the end of a test is not inert: it keeps ticking against the
// NEXT test's stubbed fetch and answers its visibilitychange dispatches. Auto-unmounting
// every wrapper is what keeps each test measuring one page instead of all of them.
enableAutoUnmount(afterEach)

describe('BookingsView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks a confirmed booking completed and reloads the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // PATCH
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'completed', workerId: null, workerName: null }]),
      })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="mark-completed"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/b1')
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  })

  it('only asks for cancel confirmation, then calls the cancel endpoint if confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST cancel
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="cancel-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/bookings/b1/cancel')
  })

  it('assigns an active worker to a confirmed booking', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'w1', name: 'Sara', active: true }, { id: 'w2', name: 'Removed', active: false }]),
      }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: 'w1', workerName: 'Sara' }),
      }) // PATCH assign-worker
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    // AppSelect wraps vue-multiselect (no native <select> to set), so drive its contract.
    // Multiple AppSelect instances now exist (the manual-booking form's own service/worker
    // pickers render above the booking cards) -- select this one by its own data-testid
    // rather than by component type.
    const select = wrapper.findComponent<typeof AppSelect>('[data-testid="assign-worker"]')
    // Only the active worker should be offered, alongside the "no worker" entry (the
    // inactive worker is filtered out client-side).
    expect(select.props('options')).toHaveLength(2)

    select.vm.$emit('update:modelValue', 'w1')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/b1/assign-worker')
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ workerId: 'w1' }) })
  })

  it('renders the service name and price as the card primary line', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو زنانه', priceSnapshot: 250000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.find('[data-testid="booking-b1"]')
    expect(card.text()).toContain('کوتاهی مو زنانه')
    expect(card.text()).toContain((250000).toLocaleString('fa-IR'))
  })

  it('re-sorts ascending by startsAt even when the API returns furthest-future first', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { id: 'far', serviceId: 's1', serviceName: 'خدمت دیر', priceSnapshot: 100000, startsAt: '2026-09-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null },
          { id: 'soon', serviceId: 's1', serviceName: 'خدمت زود', priceSnapshot: 100000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null },
        ]),
      }) // GET bookings, DESC order like the real backend
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const cards = wrapper.findAll('[data-testid^="booking-"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.attributes('data-testid')).toBe('booking-soon')
    expect(cards[1]!.attributes('data-testid')).toBe('booking-far')
  })

  it('keeps showing the assigned worker name once a booking is completed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'completed', workerId: 'w1', workerName: 'Sara' }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.find('[data-testid="booking-b1"]')
    expect(card.text()).toContain('Sara')
    // No editable select once the booking is no longer confirmed.
    expect(wrapper.find('[data-testid="assign-worker"]').exists()).toBe(false)
  })

  it('shows customer identity and a manual-entry badge for a manually recorded booking', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{
          id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000,
          startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null,
          customerName: 'علی رضایی', customerPhone: '09120000000', source: 'manual',
        }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.find('[data-testid="booking-b1"]')
    expect(card.text()).toContain('علی رضایی')
    expect(card.text()).toContain('09120000000')
    expect(card.text()).toContain('ثبت دستی')
  })

  it('submits a manual booking with the entered fields and prepends the response to the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 's1', name: 'کوتاهی مو' }]) }) // GET services
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'new-b', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 100000,
          startsAt: '2026-08-01T05:30:00.000Z', status: 'confirmed', workerId: null, workerName: null,
          customerName: null, customerPhone: '09120000000', source: 'manual',
        }),
      }) // POST manual booking
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="manual-booking-phone"]').setValue('09120000000')
    wrapper.findComponent<typeof AppSelect>('[data-testid="manual-booking-service"]').vm.$emit('update:modelValue', 's1')
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="manual-booking-date"]').vm.$emit('update:modelValue', '2026-08-01')
    await wrapper.find('[data-testid="manual-booking-time"]').setValue('09:00')
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="submit-manual-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings')
    const body = JSON.parse((fetchMock.mock.calls[3]![1] as RequestInit).body as string)
    expect(body).toMatchObject({ phone: '09120000000', serviceId: 's1' })
    // 09:00 Tehran wall-clock (+03:30, no DST) is 05:30 UTC.
    expect(body.startsAt).toBe('2026-08-01T05:30:00.000Z')

    expect(wrapper.find('[data-testid="booking-new-b"]').exists()).toBe(true)
  })

  it('jumps the day view to the new booking\'s own date so it does not silently vanish from the current filter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 's1', name: 'کوتاهی مو' }]) }) // GET services
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'far-off-b', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 100000,
          // A future date this suite can't collide with "today", whichever day it runs on.
          startsAt: '2030-06-15T05:30:00.000Z', status: 'confirmed', workerId: null, workerName: null,
          customerName: null, customerPhone: '09120000000', source: 'manual',
        }),
      }) // POST manual booking
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    // Switch into day view (defaults to today) BEFORE creating a booking for a far-off date.
    await wrapper.find('[data-testid="toggle-show-all"]').setValue(false)
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.find('[data-testid="booking-far-off-b"]').exists()).toBe(false)

    await wrapper.find('[data-testid="manual-booking-phone"]').setValue('09120000000')
    wrapper.findComponent<typeof AppSelect>('[data-testid="manual-booking-service"]').vm.$emit('update:modelValue', 's1')
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="manual-booking-date"]').vm.$emit('update:modelValue', '2030-06-15')
    await wrapper.find('[data-testid="manual-booking-time"]').setValue('09:00')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.find('[data-testid="submit-manual-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Still in day view (never re-toggled to "show all"), yet the new booking is visible --
    // the day filter itself followed the booking, not the other way around.
    expect((wrapper.find('[data-testid="toggle-show-all"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('[data-testid="booking-far-off-b"]').exists()).toBe(true)
  })

  it('filters to the selected day once the show-all toggle is switched off', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          {
            id: 'today', serviceId: 's1', serviceName: 'امروز', priceSnapshot: 100000, startsAt: new Date().toISOString(),
            status: 'confirmed', workerId: null, workerName: null, customerName: null, customerPhone: '', source: 'online',
          },
          {
            id: 'later', serviceId: 's1', serviceName: 'دیرتر', priceSnapshot: 100000, startsAt: '2030-01-01T09:00:00.000Z',
            status: 'confirmed', workerId: null, workerName: null, customerName: null, customerPhone: '', source: 'online',
          },
        ]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.findAll('[data-testid^="booking-"]')).toHaveLength(2)

    await wrapper.find('[data-testid="toggle-show-all"]').setValue(false)
    await new Promise((r) => setTimeout(r, 0))

    const cards = wrapper.findAll('[data-testid^="booking-"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.attributes('data-testid')).toBe('booking-today')
  })

  // -- Manual-approval queue --

  it('surfaces a pending request with its customer, time, duration and remaining approval time', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.get('[data-testid="pending-request-req1"]')
    expect(card.text()).toContain('رنگ مو')
    expect(card.text()).toContain('مریم احمدی')
    expect(card.text()).toContain('09120000000')
    expect(card.text()).toContain('۶۰ دقیقه')
    // Display-only countdown off the server's own deadline snapshot.
    expect(wrapper.get('[data-testid="approval-remaining-req1"]').text()).toContain('مانده')
    // The one thing that must never be implied: no payment has happened yet.
    expect(wrapper.get('[data-testid="pending-requests"]').text()).toContain('مشتری هنوز پرداختی انجام نداده است')
  })

  // The queue is deliberately outside the day filter: a request expires on its own deadline,
  // so hiding it behind "today" would let it lapse unseen.
  it('keeps the pending queue visible while the day view is filtered to another day', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="toggle-show-all"]').setValue(false)
    await new Promise((r) => setTimeout(r, 0))

    // Its agenda card is filtered out (the request is for 2030), the queue card is not.
    expect(wrapper.find('[data-testid="booking-req1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pending-request-req1"]').exists()).toBe(true)
  })

  it('approves a pending request and reloads the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST approve
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ ...PENDING_REQUEST, status: 'pending_payment', approvalExpiresAt: null, paymentExpiresAt: '2030-06-14T22:00:00.000Z' }]),
      }) // GET bookings again
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="approve-request"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/req1/approve')
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'POST' })
    // Refetched, and the approved request has left the queue.
    expect(fetchMock.mock.calls[4]![0]).toContain('/salons/mine/bookings')
    expect(wrapper.find('[data-testid="pending-request-req1"]').exists()).toBe(false)
  })

  it('requires a reason before rejecting, then posts it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST reject
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ ...PENDING_REQUEST, status: 'rejected_by_salon', approvalExpiresAt: null }]),
      }) // GET bookings again
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    // Step one only opens the reason field -- nothing is sent yet.
    await wrapper.get('[data-testid="reject-request"]').trigger('click')
    expect(wrapper.find('[data-testid="reject-reason"]').exists()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Whitespace is not a reason: the API's own DTO would 400, so it's caught here.
    await wrapper.get('[data-testid="reject-reason"]').setValue('   ')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.get('[data-testid="reject-reason-error"]').text()).toContain('دلیل الزامی است')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await wrapper.get('[data-testid="reject-reason"]').setValue('در این ساعت ظرفیت نداریم')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/req1/reject')
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ reason: 'در این ساعت ظرفیت نداریم' }),
    })
    expect(wrapper.find('[data-testid="pending-request-req1"]').exists()).toBe(false)
  })

  // Lost race: the deadline lapsed (or another device decided it) between this tab's last
  // fetch and the click, so the API 409s. The card must not linger as a stale pending
  // request -- the refetched winning state replaces it.
  it('refetches after a 409 so the queue shows the state that actually won', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: 'این درخواست دیگر در انتظار تایید نیست' }) }) // POST approve
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ ...PENDING_REQUEST, status: 'expired', approvalExpiresAt: null }]),
      }) // GET bookings again
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="approve-request"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(fetchMock.mock.calls[4]![0]).toContain('/salons/mine/bookings')
    expect(wrapper.find('[data-testid="pending-request-req1"]').exists()).toBe(false)
    // ...and the booking is still on the agenda, now reading as expired.
    expect(wrapper.get('[data-testid="booking-req1"]').text()).toContain('منقضی شده')
  })
})

// -- Live refresh (polling) --
//
// The panel has no push and no socket, so this interval is the ONLY way a request that
// arrives while the tab is already open ever reaches the owner before its deadline. These
// tests pin the four things that make the difference between a fallback and a liability:
// it announces genuinely-new work exactly once, it stops entirely while nobody is looking,
// an outage degrades quietly instead of wiping the screen, and it dies with the component.
describe('BookingsView live refresh', () => {
  // Only the interval is faked. setTimeout stays real so the `await new Promise(r =>
  // setTimeout(r, 0))` flushes this file already relies on keep working unchanged -- with
  // setTimeout faked too, every one of them would deadlock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    resetToast()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // Reset the flag WITHOUT dispatching: the wrappers are still mounted at this point
    // (enableAutoUnmount runs after this hook), and a dispatch here would restart their
    // pollers against an already-unstubbed fetch.
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  // `document.hidden` is a prototype getter, so an own property on the instance is what
  // shadows it. configurable so afterEach can put it back.
  function setTabHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  // The three fetches loadAll() issues on mount, in order.
  function mockInitialLoad(fetchMock: ReturnType<typeof vi.fn>, bookings: unknown[] = []) {
    return fetchMock
      .mockResolvedValueOnce(ok(bookings))
      .mockResolvedValueOnce(ok([])) // workers
      .mockResolvedValueOnce(ok([])) // services
  }

  async function mountLoaded(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BookingsView)
    await flush()
    return wrapper
  }

  it('announces genuinely new requests exactly once and surfaces a persistent count badge', async () => {
    const second = { ...PENDING_REQUEST, id: 'req2', approvalExpiresAt: '2030-06-14T21:30:00.000Z' }
    const fetchMock = mockInitialLoad(vi.fn(), [PENDING_REQUEST])
      .mockResolvedValue(ok([PENDING_REQUEST, second])) // every poll from here on

    const wrapper = await mountLoaded(fetchMock)

    // The queue that was already there on arrival is NOT announced -- it is what the owner
    // opened the page to look at, not news.
    expect(useToast().toasts.value).toHaveLength(0)
    expect(wrapper.find('[data-testid="new-requests-badge"]').exists()).toBe(false)

    vi.advanceTimersByTime(30_000)
    await flush()

    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]!.message).toContain('درخواست نوبت جدید')
    const badge = wrapper.get('[data-testid="new-requests-badge"]')
    expect(badge.text()).toContain((1).toLocaleString('fa-IR'))
    // ...and the card itself is marked, so a queue of several says which one is new.
    expect(wrapper.find('[data-testid="new-request-req2"]').exists()).toBe(true)

    // A second tick returning the same list must not re-announce anything.
    vi.advanceTimersByTime(30_000)
    await flush()
    expect(useToast().toasts.value).toHaveLength(1)

    // The badge is the owner's to clear.
    await badge.trigger('click')
    expect(wrapper.find('[data-testid="new-requests-badge"]').exists()).toBe(false)
  })

  it('collapses several simultaneous arrivals into one toast', async () => {
    const fetchMock = mockInitialLoad(vi.fn(), []).mockResolvedValue(
      ok([PENDING_REQUEST, { ...PENDING_REQUEST, id: 'req2' }, { ...PENDING_REQUEST, id: 'req3' }]),
    )

    const wrapper = await mountLoaded(fetchMock)
    vi.advanceTimersByTime(30_000)
    await flush()

    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]!.message).toContain((3).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="new-requests-badge"]').text()).toContain((3).toLocaleString('fa-IR'))
  })

  it('issues no requests while the tab is hidden, and refetches the moment it is visible again', async () => {
    const fetchMock = mockInitialLoad(vi.fn(), []).mockResolvedValue(ok([]))
    await mountLoaded(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    setTabHidden(true)
    vi.advanceTimersByTime(5 * 60_000) // ten intervals' worth
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Back on screen: refresh immediately rather than making the owner wait out an interval
    // at the exact moment the data is most likely to be stale.
    setTabHidden(false)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings')
  })

  it('keeps the rendered list intact and stays silent when polls fail, then recovers', async () => {
    const booking = {
      id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000,
      startsAt: '2030-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null,
    }
    const fetchMock = mockInitialLoad(vi.fn(), [booking])
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })

    const wrapper = await mountLoaded(fetchMock)

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(30_000)
      await flush()
    }

    // An outage degrades into "slightly stale", never into an emptied page...
    expect(wrapper.find('[data-testid="booking-b1"]').exists()).toBe(true)
    // ...and never into a toast per tick.
    expect(useToast().toasts.value).toHaveLength(0)
    // The one place it IS admitted, once two consecutive failures rule out a single blip.
    expect(wrapper.get('[data-testid="sync-status"]').text()).toContain('اتصال برقرار نیست')

    fetchMock.mockResolvedValue(ok([booking]))
    vi.advanceTimersByTime(30_000)
    await flush()
    expect(wrapper.get('[data-testid="sync-status"]').text()).not.toContain('اتصال برقرار نیست')
  })

  it('stops polling once the component is unmounted', async () => {
    const fetchMock = mockInitialLoad(vi.fn(), []).mockResolvedValue(ok([]))
    const wrapper = await mountLoaded(fetchMock)

    wrapper.unmount()
    vi.advanceTimersByTime(5 * 60_000)
    await flush()

    // A leaked interval would keep fetching (and writing into a dead component) for the
    // rest of the session -- the classic bug this route-level page would hit on every
    // navigation away.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never lands a background refresh on top of an in-flight mutation', async () => {
    const fetchMock = mockInitialLoad(vi.fn(), [PENDING_REQUEST])
    // The approve POST that never settles -- the window in which a poll could clobber the
    // owner's own optimistic/awaiting state.
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    fetchMock.mockResolvedValue(ok([]))

    const wrapper = await mountLoaded(fetchMock)
    await wrapper.get('[data-testid="approve-request"]').trigger('click')
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(4) // 3 initial + the hanging approve

    vi.advanceTimersByTime(3 * 30_000)
    await flush()

    // No extra GET was issued: the mutation's own refetch (once it settles) is a strictly
    // fresher read than any tick fired underneath it.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
