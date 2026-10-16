import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import RescheduleForm from '@/components/booking/RescheduleForm.vue'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { resetToast, useToast } from '@/composables/useToast'
import BookingsView from './BookingsView.vue'
import { autoConfirm } from '@/test-utils/auto-confirm'
import { tehranDateString } from '@/utils/tehran-date'
import { startOfTehranDayIso } from '@/utils/tehran-day'
import { addDaysToKey } from '@/utils/booking-schedule'

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

  // axe heading-order: the page title is the only h1, so day groups must be h2, never h3.
  it('renders day-group headings as h2 directly under the page h1', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.findAll('h3')).toHaveLength(0)
    expect(wrapper.findAll('h2').length).toBeGreaterThan(0)
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
    const confirmSpy = autoConfirm(true)
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

    // The penalty warning survives the move off window.confirm.
    expect(confirmSpy.calls).toHaveLength(1)
    expect(confirmSpy.calls[0].message).toContain('مشمول جریمه')
    expect(confirmSpy.calls[0].tone).toBe('danger')
    expect(fetchMock.mock.calls[3]![0]).toContain('/bookings/b1/cancel')
  })

  it('does not call the cancel endpoint when the cancel confirmation is declined', async () => {
    autoConfirm(false)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.find('[data-testid="cancel-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls).toHaveLength(3)
  })

  it('keeps the manual-booking form collapsed until its button is pressed, and collapses it again after a successful save', async () => {
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

    const toggle = wrapper.get('[data-testid="toggle-manual-booking"]')
    expect(toggle.text()).toContain('ثبت نوبت حضوری/تلفنی')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="manual-booking-phone"]').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-testid="manual-booking-phone"]').exists()).toBe(true)

    await wrapper.find('[data-testid="manual-booking-phone"]').setValue('09120000000')
    wrapper.findComponent<typeof AppSelect>('[data-testid="manual-booking-service"]').vm.$emit('update:modelValue', 's1')
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="manual-booking-date"]').vm.$emit('update:modelValue', '2026-08-01')
    await wrapper.find('[data-testid="manual-booking-time"]').setValue('09:00')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.find('[data-testid="submit-manual-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="manual-booking-phone"]').exists()).toBe(false)
  })

  it('gives every booking-card action a 44px touch target', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    for (const id of ['mark-completed', 'mark-no-show', 'reschedule-booking', 'cancel-booking']) {
      expect(wrapper.get(`[data-testid="${id}"]`).classes()).toContain('min-h-11')
    }
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
    expect(card.text()).toContain('۰۹۱۲۰۰۰۰۰۰۰')
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

    await wrapper.find('[data-testid="toggle-manual-booking"]').trigger('click')
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

  // Intentional change: the day view is now a time grid that reads its own window
  // (GET /salons/mine/bookings?from&to), so the fetch is routed by URL rather than call order.
  it('jumps the day view to the new booking\'s own date so it does not silently vanish from the current filter', async () => {
    const created = {
      id: 'far-off-b', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 100000,
      // A future date this suite can't collide with "today", whichever day it runs on.
      startsAt: '2030-06-15T05:30:00.000Z', endsAt: '2030-06-15T06:30:00.000Z', status: 'confirmed', workerId: null, workerName: null,
      customerName: null, customerPhone: '09120000000', source: 'manual',
    }
    let posted = false
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
      if (init?.method === 'POST') {
        posted = true
        return ok(created)
      }
      if (url.includes('/services')) return ok([{ id: 's1', name: 'کوتاهی مو' }])
      if (url.includes('/workers')) return ok([])
      // The window read: only the 2030-06-15 window contains the booking, and only once it exists.
      if (url.includes('from=')) {
        const from = new URL(url, 'http://x').searchParams.get('from')!
        return ok(posted && from <= created.startsAt && created.startsAt < new Date(Date.parse(from) + 86_400_000).toISOString() ? [created] : [])
      }
      return ok([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    // Switch into day view (defaults to today) BEFORE creating a booking for a far-off date.
    await wrapper.find('[data-testid="toggle-schedule"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.find('[data-testid="booking-far-off-b"]').exists()).toBe(false)

    await wrapper.find('[data-testid="toggle-manual-booking"]').trigger('click')
    await wrapper.find('[data-testid="manual-booking-phone"]').setValue('09120000000')
    wrapper.findComponent<typeof AppSelect>('[data-testid="manual-booking-service"]').vm.$emit('update:modelValue', 's1')
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="manual-booking-date"]').vm.$emit('update:modelValue', '2030-06-15')
    await wrapper.find('[data-testid="manual-booking-time"]').setValue('09:00')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.find('[data-testid="submit-manual-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // Still in day view (never re-toggled to "show all"), yet the new booking is visible --
    // the day filter itself followed the booking, not the other way around.
    expect(wrapper.find('[data-testid="toggle-show-all"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[data-testid="booking-far-off-b"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="schedule-block-far-off-b"]').exists()).toBe(true)
  })

  // Intentional change: the old unfiltered "all bookings" list is now split into tabs, and the
  // day view reads its own window (GET /salons/mine/bookings?from&to) instead of filtering the
  // full list client-side.
  it('shows the selected day from its own windowed read once the show-all toggle is switched off', async () => {
    const todayBooking = {
      id: 'today', serviceId: 's1', serviceName: 'امروز', priceSnapshot: 100000, startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'confirmed', workerId: null, workerName: null, customerName: null, customerPhone: '', source: 'online',
    }
    const later = {
      id: 'later', serviceId: 's1', serviceName: 'دیرتر', priceSnapshot: 100000, startsAt: '2030-01-01T09:00:00.000Z',
      status: 'confirmed', workerId: null, workerName: null, customerName: null, customerPhone: '', source: 'online',
    }
    const fetchMock = vi.fn((url: string) => {
      const body = url.includes('from=') ? [todayBooking] : url.includes('/workers') || url.includes('/services') ? [] : [todayBooking, later]
      return Promise.resolve({ ok: true, status: 200, json: async () => body })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    // List mode issues no windowed read at all.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('from='))).toBe(false)

    await wrapper.find('[data-testid="toggle-schedule"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const rangeUrl = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('from='))![0]), 'http://x')
    const today = tehranDateString(new Date())
    expect(rangeUrl.pathname).toContain('/salons/mine/bookings')
    expect(rangeUrl.searchParams.get('from')).toBe(startOfTehranDayIso(today))
    expect(rangeUrl.searchParams.get('to')).toBe(startOfTehranDayIso(addDaysToKey(today, 1)))

    const cards = wrapper.findAll('[data-testid^="booking-"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]!.attributes('data-testid')).toBe('booking-today')
    expect(wrapper.find('[data-testid="schedule-block-today"]').exists()).toBe(true)
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
    expect(card.text()).toContain('۰۹۱۲۰۰۰۰۰۰۰')
    expect(card.text()).toContain('۶۰ دقیقه')
    // Display-only countdown off the server's own deadline snapshot.
    expect(wrapper.get('[data-testid="approval-remaining-req1"]').text()).toContain('مانده')
    // The one thing that must never be implied: no payment has happened yet.
    expect(wrapper.get('[data-testid="pending-requests"]').text()).toContain('مشتری هنوز پرداختی انجام نداده است')
  })

  // The queue is deliberately never hidden by a view: a request expires on its own deadline.
  // Intentional change: outside «نیاز به اقدام» (here, the day grid) it is a compact alert strip
  // with the live countdown and a jump back to the queue, instead of the full queue cards.
  it('keeps pending requests visible as an alert strip while the day view shows another day', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: async () => (url.includes('from=') || url.includes('/workers') || url.includes('/services') ? [] : [PENDING_REQUEST]) }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="toggle-schedule"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Its agenda card is not on today's grid (the request is for 2030), the alert is.
    expect(wrapper.find('[data-testid="booking-req1"]').exists()).toBe(false)
    const alert = wrapper.get('[data-testid="pending-alert"]')
    expect(alert.text()).toContain((1).toLocaleString('fa-IR'))
    expect(alert.text()).toContain('مانده')

    await wrapper.get('[data-testid="pending-alert-open"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.get('[data-testid="tab-needs-action"]').attributes('aria-selected')).toBe('true')
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
    // ...and the booking is still on the agenda, now reading as expired. Intentional change:
    // the agenda is tabbed, and an expired request for 2030 lives under «پیش‌رو».
    await wrapper.get('[data-testid="tab-upcoming"]').trigger('click')
    expect(wrapper.get('[data-testid="booking-req1"]').text()).toContain('منقضی شده')
  })
})

// -- Reschedule: move a booking to a new time, same row, same identity. Covers the three
// contexts BookingsView actually offers it in (the pending-approval queue, a confirmed
// agenda card, a pending_payment agenda card), that a terminal status never offers it, the
// current-time display, the 409/refetch-keeps-form-open path, and the submittingId double-
// submit guard shared with every other write on this page.
describe('BookingsView reschedule', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const CONFIRMED_BOOKING = {
    id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000,
    startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null,
    customerName: null, customerPhone: '', source: 'online',
  }

  it('shows the current time and moves a confirmed booking to the newly picked one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([CONFIRMED_BOOKING]) }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST reschedule
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ ...CONFIRMED_BOOKING, startsAt: '2026-08-02T06:30:00.000Z' }]),
      }) // GET bookings again
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="reschedule-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // The booking's own current slot, stated plainly before the picker.
    const card = wrapper.get('[data-testid="booking-b1"]')
    expect(card.text()).toContain('زمان فعلی')

    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="reschedule-date"]').vm.$emit('update:modelValue', '2026-08-02')
    await wrapper.find('[data-testid="reschedule-time"]').setValue('10:00')
    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/b1/reschedule')
    // 10:00 Tehran wall-clock (+03:30, no DST) is 06:30 UTC -- same conversion the manual-
    // booking form's own date+time pair already uses.
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ startsAt: '2026-08-02T06:30:00.000Z' }) })
    // Refetched and the inline form closed, replaced by the normal action row again.
    expect(fetchMock.mock.calls[4]![0]).toContain('/salons/mine/bookings')
    expect(wrapper.find('[data-testid="reschedule-date"]').exists()).toBe(false)
    // wrapper.get() throws if the element is missing, so reaching this assertion at all is
    // the proof the normal action row came back.
    expect(wrapper.get('[data-testid="mark-completed"]').text()).toContain('انجام شد')
  })

  it('offers reschedule for a pending_payment booking, which otherwise has no agenda action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ ...CONFIRMED_BOOKING, status: 'pending_payment' }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.get('[data-testid="booking-b1"]')
    expect(card.find('[data-testid="reschedule-booking"]').exists()).toBe(true)
    // No other action exists for an unpaid booking on this page.
    expect(card.find('[data-testid="mark-completed"]').exists()).toBe(false)
    expect(card.find('[data-testid="cancel-booking"]').exists()).toBe(false)
  })

  it('offers reschedule from the pending-approval queue and posts to the salon-side route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST reschedule
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([PENDING_REQUEST]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const queueCard = wrapper.get('[data-testid="pending-request-req1"]')
    await queueCard.get('[data-testid="reschedule-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="reschedule-date"]').vm.$emit('update:modelValue', '2030-07-01')
    await wrapper.find('[data-testid="reschedule-time"]').setValue('09:00')
    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/bookings/req1/reschedule')
    expect(fetchMock.mock.calls[3]![1]).toMatchObject({ method: 'POST' })
  })

  it('never offers reschedule for a booking whose status can no longer move', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ ...CONFIRMED_BOOKING, status: 'completed' }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="booking-b1"]').find('[data-testid="reschedule-booking"]').exists()).toBe(false)
  })

  it('refetches after a reschedule conflict but keeps the form open for an immediate retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([CONFIRMED_BOOKING]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: 'ظرفیت این بازه زمانی پر است' }) }) // POST reschedule
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([CONFIRMED_BOOKING]) }) // GET bookings again
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="reschedule-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="reschedule-date"]').vm.$emit('update:modelValue', '2026-08-02')
    await wrapper.find('[data-testid="reschedule-time"]').setValue('10:00')
    await wrapper.get('[data-testid="reschedule-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Refetched (same as approve/reject's own lost-race handling)...
    expect(fetchMock.mock.calls[4]![0]).toContain('/salons/mine/bookings')
    // ...but the picker itself stays open -- the booking was never the problem, just the
    // time it was pointed at, so the owner should be able to retry without re-opening it.
    expect(wrapper.find('[data-testid="reschedule-date"]').exists()).toBe(true)
  })

  it('guards against a double-submit while a reschedule write is already in flight', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([CONFIRMED_BOOKING]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    // The reschedule POST itself never settles -- the window in which a second submit
    // attempt could otherwise double-fire.
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="reschedule-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const form = wrapper.findComponent(RescheduleForm)
    form.vm.$emit('submit', '2026-08-02T06:30:00.000Z')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(4) // 3 initial + the hanging POST

    // A second submit while the first is still in flight must be a no-op: the guard at the
    // top of submitReschedule reads the same submittingId every other write on this page
    // already uses.
    form.vm.$emit('submit', '2026-08-02T07:00:00.000Z')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(4)
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

// -- Beauty guide: the card mounts only on bookings that carry a beautyGuideId, in both the
// pending-request queue and the agenda, and fetches nothing until the owner expands it.
describe('BookingsView beauty guide', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts BeautyGuideCard only on bookings with a beautyGuideId, without fetching it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { ...PENDING_REQUEST, beautyGuideId: 'g1' },
          {
            id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000,
            startsAt: '2030-06-15T12:00:00.000Z', status: 'confirmed', workerId: null, workerName: null,
            customerName: null, customerPhone: '', source: 'online', beautyGuideId: 'g2',
          },
          {
            id: 'b2', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000,
            startsAt: '2030-06-15T14:00:00.000Z', status: 'confirmed', workerId: null, workerName: null,
            customerName: null, customerPhone: '', source: 'online', beautyGuideId: null,
          },
        ]),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="pending-request-req1"]').find('[data-testid="beauty-guide-card"]').exists()).toBe(true)
    // Intentional change: the queue lives in «نیاز به اقدام»; the agenda cards are under «پیش‌رو».
    await wrapper.get('[data-testid="tab-upcoming"]').trigger('click')
    expect(wrapper.get('[data-testid="booking-b1"]').find('[data-testid="beauty-guide-card"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="booking-b2"]').find('[data-testid="beauty-guide-card"]').exists()).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/beauty-guide'))).toBe(false)
  })
})

describe('BookingsView trust & launch readiness', () => {
  const base = {
    serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, endsAt: '2099-01-01T10:00:00.000Z',
    createdAt: '2026-01-01T09:00:00.000Z', confirmationMode: 'automatic', approvalExpiresAt: null,
    paymentExpiresAt: null, workerId: null, workerName: null, customerName: 'مریم', customerPhone: '09120000000',
    source: 'online', beautyGuideId: null,
  }
  const PAST = '2020-01-01T09:00:00.000Z'
  const FUTURE = '2099-01-01T09:00:00.000Z'

  async function mountWith(list: Record<string, unknown>[]) {
    resetSalon()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => list })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    return wrapper
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSalon()
  })

  it('shows the prepaid and amount-due lines from the API fields', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: FUTURE, status: 'confirmed', depositPaid: true, prepaidAmount: 50000, amountDue: 100000 }])
    expect(wrapper.get('[data-testid="money-prepaid-b1"]').text()).toBe(`بیعانه دریافت‌شده: ${(50000).toLocaleString('fa-IR')} تومان`)
    expect(wrapper.get('[data-testid="money-amount-due-b1"]').text()).toBe(`مبلغ قابل دریافت در سالن: ${(100000).toLocaleString('fa-IR')} تومان`)
  })

  it('shows no prepaid line when nothing was captured, and nothing at all for non-fixed pricing', async () => {
    const wrapper = await mountWith([
      { ...base, id: 'b1', startsAt: FUTURE, status: 'confirmed', prepaidAmount: 0, amountDue: 150000 },
      { ...base, id: 'b2', startsAt: FUTURE, status: 'confirmed', prepaidAmount: 0, amountDue: null },
    ])
    expect(wrapper.find('[data-testid="money-prepaid-b1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="money-amount-due-b1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="money-b2"]').exists()).toBe(false)
  })

  it('disables «انجام شد» before the start time with an accessible reason, but still offers no-show', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: FUTURE, status: 'confirmed' }])
    const btn = wrapper.get('[data-testid="mark-completed"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    const reason = wrapper.get('[data-testid="complete-reason-b1"]')
    expect(reason.text()).toBe('بعد از زمان شروع نوبت قابل ثبت است')
    expect(btn.attributes('aria-describedby')).toBe(reason.attributes('id'))
  })

  it('enables «انجام شد» once the start time has passed and shows no reason', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: PAST, status: 'confirmed' }])
    expect((wrapper.get('[data-testid="mark-completed"]').element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.find('[data-testid="complete-reason-b1"]').exists()).toBe(false)
  })

  it('does not offer complete / no-show while the salon is not approved', async () => {
    resetSalon()
    useSalon().salon.value = { id: 's', name: 'x', slug: 'x', status: 'pending', genderTarget: 'women', address: 'a', city: 'c', capacity: 1, rejectionReason: null }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ ...base, id: 'b1', startsAt: PAST, status: 'confirmed' }]) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    expect(wrapper.find('[data-testid="mark-completed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-no-show"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cancel-booking"]').exists()).toBe(true)
  })

  it('surfaces the API refusal message through the toast path when completion is refused', async () => {
    resetToast()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ ...base, id: 'b1', startsAt: PAST, status: 'confirmed' }]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'هنوز زمان نوبت فرا نرسیده است.' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.get('[data-testid="mark-completed"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(useToast().toasts.value.some((t) => t.message === 'هنوز زمان نوبت فرا نرسیده است.')).toBe(true)
  })

  it('renders cancelled_by_admin with its label and an explanatory line', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: FUTURE, status: 'cancelled_by_admin' }])
    const card = wrapper.get('[data-testid="booking-b1"]')
    expect(card.text()).toContain('لغو توسط پشتیبانی قیچی')
    expect(wrapper.get('[data-testid="admin-cancel-note-b1"]').text()).toContain('پشتیبانی قیچی لغو شده')
    expect(card.find('[data-testid="cancel-booking"]').exists()).toBe(false)
  })

  it('tells the owner a manual booking cannot be reviewed, on the card and in the form', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: FUTURE, status: 'confirmed', source: 'manual' }])
    expect(wrapper.get('[data-testid="manual-review-note-b1"]').text()).toBe('نظر مشتری برای نوبت‌های ثبت‌دستی ثبت نمی‌شود.')
    await wrapper.get('[data-testid="toggle-manual-booking"]').trigger('click')
    expect(wrapper.get('[data-testid="manual-review-note"]').text()).toBe('نظر مشتری برای نوبت‌های ثبت‌دستی ثبت نمی‌شود.')
  })

  it('does not show the manual-review note on an online booking card', async () => {
    const wrapper = await mountWith([{ ...base, id: 'b1', startsAt: FUTURE, status: 'confirmed' }])
    expect(wrapper.find('[data-testid="manual-review-note-b1"]').exists()).toBe(false)
  })

  it('keeps the manual-booking form filled and shows the API refusal for self-booking', async () => {
    resetToast()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 's1', name: 'رنگ' }]) })
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'ثبت نوبت برای صاحب یا همکار سالن ممکن نیست.' }) })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.get('[data-testid="toggle-manual-booking"]').trigger('click')
    await wrapper.get('[data-testid="manual-booking-phone"]').setValue('09120000000')
    await wrapper.findAllComponents(AppSelect)[0]!.vm.$emit('update:modelValue', 's1')
    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2099-01-01')
    await wrapper.get('[data-testid="submit-manual-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(useToast().toasts.value.some((t) => t.message === 'ثبت نوبت برای صاحب یا همکار سالن ممکن نیست.')).toBe(true)
    expect((wrapper.get('[data-testid="manual-booking-phone"]').element as HTMLInputElement).value).toBe('09120000000')
  })
})

// -- Wave 2: segmented tabs, live countdown, day/week grid --
describe('BookingsView tabs and schedule', () => {
  const NOW = Date.now()
  const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
  const row = (id: string, startsAt: string, status = 'confirmed', extra: Record<string, unknown> = {}) => ({
    id, serviceId: 's1', serviceName: `خدمت ${id}`, priceSnapshot: 100000, startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), createdAt: startsAt, status,
    confirmationMode: 'automatic', approvalExpiresAt: null, paymentExpiresAt: null, workerId: null, workerName: null,
    customerName: 'مشتری', customerPhone: '09120000000', source: 'online', beautyGuideId: null, ...extra,
  })

  // Routed by URL: list, workers, services and the windowed read are independent requests.
  function stub(list: unknown[], opts: { workers?: unknown[]; range?: (url: URL) => unknown[]; capacity?: (url: URL) => unknown } = {}) {
    const fetchMock = vi.fn((url: string) => {
      const u = new URL(url, 'http://x')
      let body: unknown = list
      if (u.pathname.endsWith('/capacity')) {
        if (!opts.capacity) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        body = opts.capacity(u)
      } else if (u.pathname.endsWith('/workers')) body = opts.workers ?? []
      else if (u.pathname.endsWith('/services')) body = []
      else if (u.searchParams.has('from')) body = opts.range ? opts.range(u) : []
      return Promise.resolve({ ok: true, status: 200, json: async () => body })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  function makeRouter() {
    return createRouter({ history: createMemoryHistory(), routes: [{ path: '/bookings', component: BookingsView }] })
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetSalon()
  })

  it('lands on «نیاز به اقدام» when requests or owed outcomes exist, with counts on the tabs', async () => {
    stub([
      row('req', iso(5 * 86_400_000), 'pending_approval', { approvalExpiresAt: iso(8 * 60_000) }),
      row('owed', iso(-3 * 86_400_000)),
      row('soon', iso(4 * 86_400_000)),
    ])
    const wrapper = mount(BookingsView)
    await flush()

    const tab = wrapper.get('[data-testid="tab-needs-action"]')
    expect(tab.attributes('aria-selected')).toBe('true')
    expect(tab.text()).toContain((2).toLocaleString('fa-IR'))
    // The queue and the owed-outcome card, but not the upcoming one.
    expect(wrapper.find('[data-testid="pending-request-req"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="booking-owed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="booking-soon"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pending-alert"]').exists()).toBe(false)

    await wrapper.get('[data-testid="tab-upcoming"]').trigger('click')
    expect(wrapper.find('[data-testid="booking-soon"]').exists()).toBe(true)
    // Off the queue's tab, the requests stay visible as the alert strip.
    expect(wrapper.find('[data-testid="pending-alert"]').exists()).toBe(true)
  })

  it('lists «گذشته» newest first', async () => {
    stub([row('old', iso(-20 * 86_400_000), 'completed'), row('recent', iso(-2 * 86_400_000), 'completed')])
    const wrapper = mount(BookingsView)
    await flush()
    expect(wrapper.get('[data-testid="tab-past"]').attributes('aria-selected')).toBe('true')
    const ids = wrapper.findAll('[data-testid^="booking-"]').map((c) => c.attributes('data-testid'))
    expect(ids).toEqual(['booking-recent', 'booking-old'])
  })

  it('says so when nothing is waiting on the owner', async () => {
    stub([row('done', iso(-2 * 86_400_000), 'completed')])
    const wrapper = mount(BookingsView)
    await flush()
    await wrapper.get('[data-testid="tab-needs-action"]').trigger('click')
    expect(wrapper.get('[data-testid="needs-action-clear"]').text()).toContain('همه‌چیز مرتب است')
  })

  it('filters a tab by status chips built from the statuses actually in it', async () => {
    stub([
      row('c1', iso(3 * 86_400_000)),
      row('x1', iso(4 * 86_400_000), 'cancelled_by_user'),
      row('c2', iso(5 * 86_400_000)),
    ])
    const wrapper = mount(BookingsView)
    await flush()
    expect(wrapper.get('[data-testid="status-chip-all"]').text()).toContain((3).toLocaleString('fa-IR'))
    expect(wrapper.find('[data-testid="status-chip-completed"]').exists()).toBe(false)

    await wrapper.get('[data-testid="status-chip-cancelled_by_user"]').trigger('click')
    expect(wrapper.findAll('[data-testid^="booking-"]').map((c) => c.attributes('data-testid'))).toEqual(['booking-x1'])
    expect(wrapper.get('[data-testid="status-chip-cancelled_by_user"]').attributes('aria-pressed')).toBe('true')

    // Changing tab resets the filter.
    await wrapper.get('[data-testid="tab-today"]').trigger('click')
    await wrapper.get('[data-testid="tab-upcoming"]').trigger('click')
    expect(wrapper.findAll('[data-testid^="booking-"]')).toHaveLength(3)
  })

  it('moves between tabs with the arrow keys (RTL: left is next)', async () => {
    stub([])
    const wrapper = mount(BookingsView, { attachTo: document.body })
    await flush()
    expect(wrapper.get('[data-testid="tab-today"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="tab-today"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('[data-testid="tab-upcoming"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="tab-upcoming"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-testid="tab-today"]').attributes('aria-selected')).toBe('true')
  })

  it('honours ?tab= and writes the chosen tab back to the URL', async () => {
    stub([row('owed', iso(-3 * 86_400_000))])
    const router = makeRouter()
    await router.push('/bookings?tab=past')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()
    expect(wrapper.get('[data-testid="tab-past"]').attributes('aria-selected')).toBe('true')

    await wrapper.get('[data-testid="tab-needs-action"]').trigger('click')
    await flush()
    expect(router.currentRoute.value.query.tab).toBe('needs-action')
  })

  it('opens the week grid from ?view=week and reads exactly that Saturday-to-Friday window', async () => {
    const fetchMock = stub([], { range: () => [row('w1', iso(60_000))] })
    const router = makeRouter()
    await router.push('/bookings?view=week&date=2026-10-14')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()

    const rangeUrl = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('from='))![0]), 'http://x')
    // 2026-10-14 (Wednesday) -> its week is Sat 10th .. Fri 16th, i.e. [Tehran midnight of the
    // 10th, Tehran midnight of the 17th).
    expect(rangeUrl.searchParams.get('from')).toBe('2026-10-09T20:30:00.000Z')
    expect(rangeUrl.searchParams.get('to')).toBe('2026-10-16T20:30:00.000Z')
    expect(wrapper.findAll('[data-testid^="schedule-col-"]')).toHaveLength(7)

    // Next week: a new window, and the URL follows.
    await wrapper.get('[data-testid="next-day"]').trigger('click')
    await flush()
    const urls = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/salons/mine/bookings?from='))
    expect(new URL(urls[urls.length - 1]!, 'http://x').searchParams.get('from')).toBe('2026-10-16T20:30:00.000Z')
    expect(router.currentRoute.value.query).toMatchObject({ view: 'week', date: '2026-10-21' })
  })

  it('shows a week block\'s full card, with its actions, once the block is picked', async () => {
    const startsAt = iso(2 * 86_400_000)
    stub([], { range: () => [row('w1', startsAt)] })
    const router = makeRouter()
    await router.push(`/bookings?view=week&date=${tehranDateString(new Date(startsAt))}`)
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()

    expect(wrapper.find('[data-testid="booking-w1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="schedule-pick-hint"]').exists()).toBe(true)
    await wrapper.get('[data-testid="schedule-block-w1"]').trigger('click')
    await flush()
    const card = wrapper.get('[data-testid="booking-w1"]')
    expect(card.find('[data-testid="cancel-booking"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="schedule-block-w1"]').attributes('aria-pressed')).toBe('true')
  })

  it('splits the day grid into one column per active worker plus unassigned, and leaves cancelled bookings off it', async () => {
    const t = iso(60 * 60_000)
    stub([], {
      workers: [{ id: 'w1', name: 'سارا', active: true }, { id: 'w2', name: 'مینا', active: true }, { id: 'w3', name: 'قدیمی', active: false }],
      range: () => [
        row('a', t, 'confirmed', { workerId: 'w1', workerName: 'سارا' }),
        row('b', t, 'confirmed'),
        row('c', t, 'cancelled_by_user', { workerId: 'w2', workerName: 'مینا' }),
      ],
    })
    const wrapper = mount(BookingsView)
    await flush()
    await wrapper.get('[data-testid="toggle-schedule"]').trigger('click')
    await flush()

    expect(wrapper.findAll('[data-testid^="schedule-col-"]').map((c) => c.attributes('data-testid'))).toEqual([
      'schedule-col-w1', 'schedule-col-w2', 'schedule-col-unassigned',
    ])
    expect(wrapper.get('[data-testid="schedule-col-w1"]').find('[data-testid="schedule-block-a"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="schedule-col-unassigned"]').find('[data-testid="schedule-block-b"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="schedule-block-c"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="schedule-hidden-note"]').text()).toContain((1).toLocaleString('fa-IR'))
    // The day's agenda cards (all statuses) sit beside the grid.
    expect(wrapper.find('[data-testid="booking-c"]').exists()).toBe(true)
  })

  it('switches views with a two-button segmented control; picking the selected side is a no-op', async () => {
    const fetchMock = stub([])
    const wrapper = mount(BookingsView)
    await flush()
    const list = wrapper.get('[data-testid="toggle-show-all"]')
    const grid = wrapper.get('[data-testid="toggle-schedule"]')
    expect(list.element.tagName).toBe('BUTTON')
    expect(list.attributes('aria-pressed')).toBe('true')
    expect(grid.attributes('aria-pressed')).toBe('false')

    // Clicking the already-selected «فهرست» must not flip to the grid.
    await list.trigger('click')
    await flush()
    expect(list.attributes('aria-pressed')).toBe('true')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('from='))).toBe(false)

    await grid.trigger('click')
    await flush()
    expect(grid.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="schedule-grid"]').exists()).toBe(true)
    await grid.trigger('click')
    await flush()
    expect(grid.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="schedule-grid"]').exists()).toBe(true)
  })

  it('marks closed days on the week grid from the capacity read for the same window', async () => {
    const fetchMock = stub([], {
      capacity: (u) => ({
        days: [
          { date: '2026-10-10', closedReason: null },
          { date: '2026-10-16', closedReason: 'no_hours' },
          { date: '2026-10-12', closedReason: 'closed_exception' },
        ],
        from: u.searchParams.get('from'),
      }),
    })
    const router = makeRouter()
    await router.push('/bookings?view=week&date=2026-10-14')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()

    const capUrl = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/capacity'))![0]), 'http://x')
    // Same Saturday-to-Friday window, as Tehran day keys with an exclusive end.
    expect(capUrl.searchParams.get('from')).toBe('2026-10-10')
    expect(capUrl.searchParams.get('to')).toBe('2026-10-17')
    expect(wrapper.find('[data-testid="schedule-closed-2026-10-16"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="schedule-closed-2026-10-12"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="schedule-closed-2026-10-10"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="schedule-col-2026-10-16"]').text()).toContain('تعطیل')
  })

  it('says a closed day out loud in day view, and draws no marker when the capacity read fails', async () => {
    stub([], { capacity: () => ({ days: [{ date: '2026-10-14', closedReason: 'no_hours' }] }) })
    const router = makeRouter()
    await router.push('/bookings?view=day&date=2026-10-14')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()
    expect(wrapper.get('[data-testid="schedule-closed-day"]').text()).toContain('تعطیل')

    stub([]) // capacity now 500s
    const router2 = makeRouter()
    await router2.push('/bookings?view=day&date=2026-10-14')
    await router2.isReady()
    const failed = mount(BookingsView, { global: { plugins: [router2] } })
    await flush()
    expect(failed.find('[data-testid="schedule-grid"]').exists()).toBe(true)
    expect(failed.find('[data-testid="schedule-closed-day"]').exists()).toBe(false)
    expect(failed.find('[data-testid^="schedule-closed-"]').exists()).toBe(false)
  })

  it('zero-pads schedule and card times («۰۹:۰۰»)', async () => {
    // 05:30Z = 09:00 Tehran.
    stub([], { range: () => [row('z', '2026-10-14T05:30:00.000Z')] })
    const router = makeRouter()
    await router.push('/bookings?view=day&date=2026-10-14')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()
    expect(wrapper.get('[data-testid="schedule-block-z"]').text()).toContain('۰۹:۰۰')
    expect(wrapper.get('[data-testid="schedule-grid"]').text()).toContain('۰۹:۰۰')
    expect(wrapper.get('[data-testid="booking-z"]').text()).toContain('۰۹:۰۰')
  })

  it('offers a retry when the window read fails, instead of an empty grid', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.includes('from=') ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => [] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(BookingsView)
    await flush()
    await wrapper.get('[data-testid="toggle-schedule"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="schedule-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="retry-schedule"]').exists()).toBe(true)
  })

  // Regression: in week view a manual booking for ANOTHER week moved the window, and the
  // window watcher then cleared the selection the submit had just made -- so the week view
  // (which shows only the picked block's card) showed no card for the booking just created.
  it('keeps the just-created manual booking selected when it jumps the week grid to another week', async () => {
    const created = row('far-week', '2030-06-15T05:30:00.000Z', 'confirmed', { source: 'manual' })
    let posted = false
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
      if (init?.method === 'POST') {
        posted = true
        return ok(created)
      }
      const u = new URL(url, 'http://x')
      if (u.pathname.endsWith('/services')) return ok([{ id: 's1', name: 'کوتاهی مو' }])
      if (u.pathname.endsWith('/workers')) return ok([])
      if (u.searchParams.has('from')) {
        const from = u.searchParams.get('from')!
        const to = u.searchParams.get('to')!
        return ok(posted && from <= created.startsAt && created.startsAt < to ? [created] : [])
      }
      return ok([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/bookings?view=week')
    await router.isReady()
    const wrapper = mount(BookingsView, { global: { plugins: [router] } })
    await flush()

    await wrapper.get('[data-testid="toggle-manual-booking"]').trigger('click')
    await wrapper.get('[data-testid="manual-booking-phone"]').setValue('09120000000')
    wrapper.findComponent<typeof AppSelect>('[data-testid="manual-booking-service"]').vm.$emit('update:modelValue', 's1')
    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="manual-booking-date"]').vm.$emit('update:modelValue', '2030-06-15')
    await wrapper.get('[data-testid="manual-booking-time"]').setValue('09:00')
    await flush()
    await wrapper.get('[data-testid="submit-manual-booking"]').trigger('click')
    await flush()
    await flush()

    expect(wrapper.find('[data-testid="schedule-block-far-week"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="schedule-block-far-week"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="booking-far-week"]').exists()).toBe(true)
  })

  it('ticks the approval countdown every second in mm:ss', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2030-06-14T20:50:00.000Z'))
    stub([{ ...PENDING_REQUEST, approvalExpiresAt: '2030-06-14T20:59:30.000Z' }])
    const wrapper = mount(BookingsView)
    await flush()

    const badge = () => wrapper.get('[data-testid="approval-remaining-req1"]')
    expect(badge().text()).toContain('۰۹:۳۰ مانده')
    expect(badge().attributes('role')).toBe('timer')
    vi.advanceTimersByTime(5_000)
    await flush()
    expect(badge().text()).toContain('۰۹:۲۵ مانده')
  })
})
