import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SlotPicker from '../../app/components/booking/SlotPicker.vue'

// Same pattern as useApi.spec.ts / auth.global.spec.ts: `useApi` wraps the real
// `$fetch` global rather than being an unimport-tracked auto-import composable of its
// own, so the established way to control its behavior in a test is to stub `$fetch`
// directly (via `vi.stubGlobal`) and let the real `useApi` run on top of it.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

describe('SlotPicker', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the first date with slots and emits the chosen ISO instant on click', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-10', slots: [] },
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z', '2026-07-11T09:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const buttons = wrapper.findAll('[data-testid="slot-button"]')
    expect(buttons).toHaveLength(2)

    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-07-11T09:00:00.000Z'])
  })

  it('reflects the selectedSlot prop as the visually/ARIA-confirmed selected time button', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z', '2026-07-11T09:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, {
      props: { salonId: 's1', serviceId: 'sv1', selectedSlot: '2026-07-11T09:00:00.000Z' },
    })
    const buttons = wrapper.findAll('[data-testid="slot-button"]')

    // Neutral "chosen" fill, not the brand accent -- this page's one accent seal is
    // reserved for the final "پرداخت و رزرو" button, never a date/time pick along the way.
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[0]!.classes()).toContain('bg-(--color-text)')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false')
    expect(buttons[1]!.classes()).not.toContain('bg-(--color-text)')
  })

  it('has no selected time button, and aria-pressed=false on every one, when selectedSlot is unset', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z', '2026-07-11T09:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const buttons = wrapper.findAll('[data-testid="slot-button"]')

    for (const button of buttons) {
      expect(button.attributes('aria-pressed')).toBe('false')
      expect(button.classes()).not.toContain('bg-(--color-text)')
    }
  })

  it('marks the selected date pill with aria-pressed and the neutral chosen fill, unselected pills false', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
      { date: '2026-07-12', slots: ['2026-07-12T10:00:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const dateChips = wrapper.findAll('button').filter((b) => !b.attributes('data-testid'))

    expect(dateChips[0]!.attributes('aria-pressed')).toBe('true')
    expect(dateChips[0]!.classes()).toContain('bg-(--color-text)')
    expect(dateChips[1]!.attributes('aria-pressed')).toBe('false')
    expect(dateChips[1]!.classes()).not.toContain('bg-(--color-text)')

    await dateChips[1]!.trigger('click')
    expect(dateChips[0]!.attributes('aria-pressed')).toBe('false')
    expect(dateChips[1]!.attributes('aria-pressed')).toBe('true')
  })

  it('meets the >=44px touch-target height on both date pills and time-slot buttons', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const dateChips = wrapper.findAll('button').filter((b) => !b.attributes('data-testid'))
    const slotButtons = wrapper.findAll('[data-testid="slot-button"]')

    expect(dateChips[0]!.classes()).toContain('min-h-11')
    expect(slotButtons[0]!.classes()).toContain('min-h-11')
    // rounded-lg (8px) is banned by the design system's control-radius scale; slot
    // buttons must use rounded-xl (12px) instead.
    expect(slotButtons[0]!.classes()).not.toContain('rounded-lg')
    expect(slotButtons[0]!.classes()).toContain('rounded-xl')
  })

  it('shows an empty state when no day has any slots', async () => {
    fetchMock.mockResolvedValue([{ date: '2026-07-10', slots: [] }])
    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.text()).toContain('نوبت خالی')
  })

  it('switches the displayed slots when a different date chip is clicked', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
      { date: '2026-07-12', slots: ['2026-07-12T10:00:00.000Z', '2026-07-12T10:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.findAll('[data-testid="slot-button"]')).toHaveLength(1)

    const dateChips = wrapper.findAll('button').filter((b) => !b.attributes('data-testid'))
    await dateChips[1]!.trigger('click')

    const buttons = wrapper.findAll('[data-testid="slot-button"]')
    expect(buttons).toHaveLength(2)
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-07-12T10:00:00.000Z'])
  })

  // The API doesn't promise a day's own slots array is time-ordered, and a real salon's
  // response has shown up here scrambled -- 17:30, 17:00, 16:30, 16:00, 19:30, 19:00, 18:30,
  // 18:00, which read as random to a customer scanning for the earliest opening. This feeds
  // that exact scrambled order in and checks the rendered buttons come out chronological.
  it('renders a scrambled availability response in chronological order, grouped by day-part', async () => {
    fetchMock.mockResolvedValue([
      {
        date: '2026-07-11',
        slots: [
          '2026-07-11T14:00:00.000Z', // 17:30 Tehran
          '2026-07-11T13:30:00.000Z', // 17:00
          '2026-07-11T13:00:00.000Z', // 16:30
          '2026-07-11T12:30:00.000Z', // 16:00
          '2026-07-11T16:00:00.000Z', // 19:30
          '2026-07-11T15:30:00.000Z', // 19:00
          '2026-07-11T15:00:00.000Z', // 18:30
          '2026-07-11T14:30:00.000Z', // 18:00
        ],
      },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })

    const times = wrapper.findAll('[data-testid="slot-button"]').map((b) => b.text())
    expect(times).toEqual(['16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'])

    // 16:00/16:30 fall in "بعدازظهر" (afternoon, before 17:00); everything else lands in
    // "عصر و شب" (evening) -- and the afternoon heading must appear first in the DOM.
    const headings = wrapper.findAll('p').map((p) => p.text())
    const afternoonIndex = headings.indexOf('بعدازظهر')
    const eveningIndex = headings.indexOf('عصر و شب')
    expect(afternoonIndex).toBeGreaterThanOrEqual(0)
    expect(eveningIndex).toBeGreaterThan(afternoonIndex)
  })

  it('shows an error state when the availability request fails', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.text()).toContain('مشکلی پیش آمد')
  })
})
