import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HoursView from './HoursView.vue'

describe('HoursView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('truncates HH:MM:SS hours from the API to HH:MM before re-saving an untouched day', async () => {
    // Postgres `time` columns round-trip through pg as HH:MM:SS.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ weekday: 6, openTime: '09:00:00', closeTime: '18:00:00' }]),
      }) // GET hours
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    // Save without touching any field -- the previously loaded day must not be re-sent with seconds.
    await wrapper.find('[data-testid="save-hours"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const putCall = fetchMock.mock.calls[2]!
    expect(putCall[0]).toContain('/salons/mine/hours')
    expect(putCall[1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(putCall[1].body)).toEqual({
      hours: [{ weekday: 6, openTime: '09:00', closeTime: '18:00' }],
    })
  })

  it('shows a retry-capable error state and hides the save action when the initial load fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // GET hours fails
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-hours"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="save-hours"]').exists()).toBe(false)
  })

  it('blocks saving and shows an inline error when an enabled day\'s closeTime is not after openTime', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ weekday: 1, openTime: '20:00:00', closeTime: '09:00:00' }]),
      }) // GET hours -- enabled day with an invalid (overnight) range
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="save-hours"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Only the two initial GETs happened -- no PUT was fired.
    expect(fetchMock.mock.calls.length).toBe(2)
    expect(wrapper.text()).toContain('ساعت پایان باید بعد از ساعت شروع باشد')
  })

  it('does not delete a schedule exception without confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'ex-1', date: '2026-08-01', isClosed: true }]),
      }) // GET exceptions
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[aria-label="حذف تعطیلی"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalled()
    // Only the two initial GETs happened -- no DELETE was fired.
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('deletes a schedule exception after confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'ex-1', date: '2026-08-01', isClosed: true }]),
      }) // GET exceptions
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE exception
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions (reload)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[aria-label="حذف تعطیلی"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const deleteCall = fetchMock.mock.calls[2]!
    expect(deleteCall[0]).toContain('/salons/mine/exceptions/ex-1')
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
  })
})
