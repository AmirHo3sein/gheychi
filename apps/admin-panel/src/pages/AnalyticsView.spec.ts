import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsView from './AnalyticsView.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

function ok<T>(data: T) {
  return { data, error: null }
}

const summary = {
  from: '2026-07-02T00:00:00.000Z',
  to: '2026-08-01T00:00:00.000Z',
  totalsByEvent: [
    { eventName: 'booking_started', count: 120 },
    { eventName: 'booking_confirmed', count: 90 },
    { eventName: 'payment_succeeded', count: 80 },
    { eventName: 'search_performed', count: 4321 },
  ],
  funnelByDay: [
    { date: '2026-07-31', booking_started: 10, booking_confirmed: 8, payment_succeeded: 4 },
    // Zero starts that day -- the conversion rate must not divide by zero.
    { date: '2026-08-01', booking_started: 0, booking_confirmed: 0, payment_succeeded: 0 },
  ],
}

describe('AnalyticsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows a loading indicator, not a false empty state, while the initial fetch is in flight', async () => {
    let resolveFetch!: (value: { data: typeof summary; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(AnalyticsView)

    expect(wrapper.find('[data-testid="analytics-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="analytics-error"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('داده‌ای برای این بازه زمانی ثبت نشده است.')

    resolveFetch(ok(summary))
    await flushPromises()

    expect(wrapper.find('[data-testid="analytics-loading"]').exists()).toBe(false)
  })

  it('renders the translated Persian event labels and fa-IR formatted counts for a populated range', async () => {
    fetchMock.mockResolvedValue(ok(summary))
    const wrapper = mount(AnalyticsView)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/analytics/summary', { silent: true })

    // Raw snake_case event names never reach the page -- only their Farsi labels do.
    expect(wrapper.text()).toContain('شروع رزرو')
    expect(wrapper.text()).toContain('تایید رزرو')
    expect(wrapper.text()).toContain('پرداخت موفق')
    expect(wrapper.text()).toContain('جستجو')
    expect(wrapper.text()).not.toContain('booking_started')
    expect(wrapper.text()).not.toContain('search_performed')

    // Counts render fa-IR digit-grouped, matching the rest of the app.
    expect(wrapper.text()).toContain((4321).toLocaleString('fa-IR'))
    expect(wrapper.findAll('[data-testid="event-total-row"]')).toHaveLength(4)

    // Funnel table: both funnel days present, with a real (non-zero-divide) conversion rate.
    expect(wrapper.findAll('[data-testid="funnel-day-row"]')).toHaveLength(2)
    // 8/10 confirmed and 4/8 paid on the first day -> 80% and 50%.
    expect(wrapper.text()).toContain(`${(80).toLocaleString('fa-IR')}٪`)
    expect(wrapper.text()).toContain(`${(50).toLocaleString('fa-IR')}٪`)
    // The zero-starts day must show a dash, not a 0% or NaN% conversion rate.
    expect(wrapper.text()).toContain('—')
  })

  it('shows a distinct empty state, not a false error, when the range has no events at all', async () => {
    fetchMock.mockResolvedValue(ok({ from: summary.from, to: summary.to, totalsByEvent: [], funnelByDay: [] }))
    const wrapper = mount(AnalyticsView)
    await flushPromises()

    expect(wrapper.text()).toContain('داده‌ای برای این بازه زمانی ثبت نشده است.')
    expect(wrapper.find('[data-testid="analytics-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="event-total-row"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="funnel-day-row"]').exists()).toBe(false)
  })

  it('shows a distinct error state with retry when the fetch fails, instead of reading as an empty range', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 500, message: 'Internal error' } })
    const wrapper = mount(AnalyticsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="analytics-error"]').exists()).toBe(true)
    // A silently-broken fetch must never render as a truthful "no data" empty state.
    expect(wrapper.text()).not.toContain('داده‌ای برای این بازه زمانی ثبت نشده است.')

    fetchMock.mockResolvedValue(ok(summary))
    await wrapper.get('[data-testid="analytics-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="analytics-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="event-total-row"]').length).toBeGreaterThan(0)
  })

  it('sends local-day-anchored from/to params once both range inputs are set', async () => {
    fetchMock.mockResolvedValue(ok(summary))
    const wrapper = mount(AnalyticsView)
    await flushPromises()
    fetchMock.mockClear()

    // JalaliDatePicker isn't a native input -- drive its v-model contract directly, same as
    // FeaturedView.spec.ts's pattern for JalaliDatePicker-backed filters.
    const [fromPicker, toPicker] = wrapper.findAllComponents(JalaliDatePicker)
    await fromPicker!.vm.$emit('update:modelValue', '2026-07-01')
    await flushPromises()
    await toPicker!.vm.$emit('update:modelValue', '2026-08-01')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/admin/analytics/summary?from=${encodeURIComponent(new Date('2026-07-01T00:00:00.000').toISOString())}&to=${encodeURIComponent(new Date('2026-08-01T23:59:59.999').toISOString())}`,
      { silent: true },
    )
  })

  it('shows the "پاک‌کردن فیلتر" button only once a range is set, and clearing it reloads the default range', async () => {
    fetchMock.mockResolvedValue(ok(summary))
    const wrapper = mount(AnalyticsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="analytics-clear-filters"]').exists()).toBe(false)

    const [fromPicker] = wrapper.findAllComponents(JalaliDatePicker)
    await fromPicker!.vm.$emit('update:modelValue', '2026-07-01')
    await flushPromises()
    expect(wrapper.find('[data-testid="analytics-clear-filters"]').exists()).toBe(true)

    fetchMock.mockClear()
    await wrapper.get('[data-testid="analytics-clear-filters"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/analytics/summary', { silent: true })
    expect(wrapper.find('[data-testid="analytics-clear-filters"]').exists()).toBe(false)
  })
})
