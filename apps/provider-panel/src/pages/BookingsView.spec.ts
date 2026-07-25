import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

    expect(fetchMock.mock.calls[2]![0]).toContain('/salons/mine/bookings/b1')
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST cancel
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="cancel-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[2]![0]).toContain('/bookings/b1/cancel')
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو', priceSnapshot: 150000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: 'w1', workerName: 'Sara' }),
      }) // PATCH assign-worker
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const select = wrapper.find('[data-testid="assign-worker"]')
    // Only the active worker should be offered as an option (the inactive one is filtered out client-side).
    expect(select.findAll('option')).toHaveLength(2)

    await select.setValue('w1')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[2]![0]).toContain('/salons/mine/bookings/b1/assign-worker')
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ workerId: 'w1' }) })
  })

  it('renders the service name and price as the card primary line', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', serviceName: 'کوتاهی مو زنانه', priceSnapshot: 250000, startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed', workerId: null, workerName: null }]),
      }) // GET bookings
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET workers
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.find('[data-testid="booking-b1"]')
    expect(card.text()).toContain('کوتاهی مو زنانه')
    // fa-IR locale formatting renders Persian digits, matching this app's RTL-only convention.
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
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    const card = wrapper.find('[data-testid="booking-b1"]')
    expect(card.text()).toContain('Sara')
    // No editable select once the booking is no longer confirmed.
    expect(wrapper.find('[data-testid="assign-worker"]').exists()).toBe(false)
  })
})
