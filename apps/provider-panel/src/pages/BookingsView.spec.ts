import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import BookingsView from './BookingsView.vue'

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
})
