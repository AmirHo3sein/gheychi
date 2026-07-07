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
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed' }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // PATCH
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'completed' }]),
      })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="mark-completed"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[1]![0]).toContain('/salons/mine/bookings/b1')
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  })

  it('only asks for cancel confirmation, then calls the cancel endpoint if confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed' }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST cancel
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="cancel-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[1]![0]).toContain('/bookings/b1/cancel')
  })
})
