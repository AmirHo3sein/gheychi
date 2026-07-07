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
})
