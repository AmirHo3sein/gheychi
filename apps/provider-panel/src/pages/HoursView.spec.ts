import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HoursView from './HoursView.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

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

  it('loads two working_hours rows for the same weekday as one day with two ranges, and re-saves both untouched', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { weekday: 6, openTime: '09:00:00', closeTime: '13:00:00' },
          { weekday: 6, openTime: '14:00:00', closeTime: '20:00:00' },
        ]),
      }) // GET hours -- a lunch-break split shift
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="day-6"]').findAll('input[type="time"]')).toHaveLength(4)

    await wrapper.find('[data-testid="save-hours"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const putCall = fetchMock.mock.calls[2]!
    expect(JSON.parse(putCall[1].body)).toEqual({
      hours: [
        { weekday: 6, openTime: '09:00', closeTime: '13:00' },
        { weekday: 6, openTime: '14:00', closeTime: '20:00' },
      ],
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

  it('submits a whole-day exception with no time range even when a reason is given', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'ex-2' }) }) // POST exception
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions (reload)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2026-08-10')
    await wrapper.find('[data-testid="exception-reason"]').setValue('تعطیلات نوروز')
    await wrapper.find('[data-testid="add-exception"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const postCall = fetchMock.mock.calls[2]!
    expect(JSON.parse(postCall[1].body)).toEqual({ date: '2026-08-10', isClosed: true, reason: 'تعطیلات نوروز' })
  })

  it('submits a partial-day exception with the chosen time range, and resets the form after success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'ex-2' }) }) // POST exception
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions (reload)
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2026-08-10')
    await wrapper.find('[data-testid="exception-partial-day"]').setValue(true)
    const [startInput, endInput] = wrapper.findAll('input[type="time"]')
    await startInput!.setValue('13:00')
    await endInput!.setValue('14:00')
    await wrapper.find('[data-testid="add-exception"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const postCall = fetchMock.mock.calls[2]!
    expect(JSON.parse(postCall[1].body)).toEqual({ date: '2026-08-10', isClosed: true, startTime: '13:00', endTime: '14:00' })
    // Partial-day checkbox unchecks itself, so its time fields don't linger on screen
    // implying a closure that's no longer actually queued.
    expect((wrapper.find('[data-testid="exception-partial-day"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('keeps the form filled in when the API rejects the submission, instead of silently clearing it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET exceptions
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'startTime must be before endTime' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2026-08-10')
    await wrapper.find('[data-testid="add-exception"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // Only the two initial GETs + the rejected POST happened -- no reload was triggered.
    expect(fetchMock.mock.calls.length).toBe(3)
    expect(wrapper.findComponent(JalaliDatePicker).props('modelValue')).toBe('2026-08-10')
  })

  it('shows the time range and reason alongside an existing partial-day exception', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'ex-3', date: '2026-08-10', isClosed: true, startTime: '13:00:00', endTime: '14:00:00', reason: 'تعمیرات', workerId: null }]),
      })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('۱۳:۰۰ تا ۱۴:۰۰')
    expect(wrapper.text()).toContain('تعمیرات')
  })

  // GET /salons/mine/exceptions returns whole-salon closures AND per-worker days off in one
  // list (schedule.controller.ts listExceptions). A worker's leave is TeamView.vue's feature;
  // rendering it here would present it as the salon being closed that day, with a delete
  // button that removes the worker's leave.
  it('renders only whole-salon closures, never a worker-scoped day off', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([
          { id: 'ex-salon', date: '2026-08-01', isClosed: true, startTime: null, endTime: null, reason: 'تعطیلات', workerId: null },
          { id: 'ex-worker', date: '2026-08-02', isClosed: true, startTime: null, endTime: null, reason: 'مرخصی سارا', workerId: 'w1' },
        ]),
      }) // GET exceptions
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HoursView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('تعطیلات')
    expect(wrapper.text()).not.toContain('مرخصی سارا')
    // Exactly one closure card -- so exactly one delete control, and it belongs to the
    // salon-wide row, not the worker's.
    expect(wrapper.findAll('[aria-label="حذف تعطیلی"]')).toHaveLength(1)
  })

  it('does not delete a schedule exception without confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // GET hours
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'ex-1', date: '2026-08-01', isClosed: true, startTime: null, endTime: null, reason: null, workerId: null }]),
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
        json: async () => ([{ id: 'ex-1', date: '2026-08-01', isClosed: true, startTime: null, endTime: null, reason: null, workerId: null }]),
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
