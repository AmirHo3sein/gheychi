import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScheduleStep from './ScheduleStep.vue'

function mountStep(overrides: Record<number, { ranges: { openTime: string; closeTime: string }[]; enabled?: boolean }> = {}) {
  return mount(ScheduleStep, {
    props: {
      modelValue: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: overrides[weekday]?.enabled ?? false,
        ranges: overrides[weekday]?.ranges ?? [{ openTime: '09:00', closeTime: '20:00' }],
      })),
    },
  })
}

describe('ScheduleStep', () => {
  it('renders one row per weekday with one range (two time fields) by default', () => {
    const wrapper = mountStep()

    expect(wrapper.findAll('[data-testid^="day-"]')).toHaveLength(7)
    expect(wrapper.get('[data-testid="day-0"]').findAll('input[type="time"]')).toHaveLength(2)
  })

  // Layout regression. A `<input type="time">` has an intrinsic min-content width of ~85px
  // that flex-1 cannot shrink past, so a single row of "day name + open + تا + close" needed
  // ~320px inside a card that only offers ~264px at a 320px viewport (and ~304px at the very
  // common 360px budget Android). The row therefore has to stack below sm -- and in RTL that
  // overflow escapes off the LEFT edge, where it is easy to miss in review.
  it('stacks the day label above the time fields below sm, and only lines them up from sm up', () => {
    const row = mountStep().get('[data-testid="day-0"]')

    expect(row.classes()).toContain('flex-col')
    expect(row.classes()).toContain('sm:flex-row')
    // The 24-unit label width is what forced the overflow -- it must not apply below sm.
    const label = row.get('label')
    expect(label.classes()).toContain('sm:w-24')
    expect(label.classes()).not.toContain('w-24')
  })

  it('lets both time fields shrink inside their row instead of forcing it wider', () => {
    const inputs = mountStep().get('[data-testid="day-0"]').findAll('input[type="time"]')

    // min-w-0 is what actually defeats the intrinsic minimum width; flex-1 alone does not.
    for (const input of inputs) {
      expect(input.classes()).toContain('min-w-0')
      expect(input.classes()).toContain('flex-1')
    }
  })

  it('keeps the 44px touch-target floor on every control in a row', () => {
    const row = mountStep({ 0: { enabled: true, ranges: [{ openTime: '09:00', closeTime: '13:00' }, { openTime: '14:00', closeTime: '20:00' }] } }).get(
      '[data-testid="day-0"]',
    )

    expect(row.get('label').classes()).toContain('min-h-11')
    for (const input of row.findAll('input[type="time"]')) {
      expect(input.classes()).toContain('min-h-11')
    }
    expect(row.get('[data-testid="add-range"]').classes()).toContain('min-h-11')
    expect(row.get('[data-testid="remove-range"]').classes()).toContain('h-11')
  })

  // Iran's week starts شنبه (Saturday), not یکشنبه (Sunday) -- rendering rows in stored-int
  // order (0=Sunday first) read as a foreign week to every Iranian user of this screen.
  it('renders the week starting from Saturday, ending on Friday', () => {
    const rows = mountStep().findAll('[data-testid^="day-"]')
    const renderedWeekdays = rows.map((r) => Number(r.attributes('data-testid')!.replace('day-', '')))
    expect(renderedWeekdays).toEqual([6, 0, 1, 2, 3, 4, 5])
  })

  it('renders a second time-field pair for a day with two ranges (a lunch-break split shift)', () => {
    const wrapper = mountStep({
      1: { enabled: true, ranges: [{ openTime: '09:00', closeTime: '13:00' }, { openTime: '14:00', closeTime: '20:00' }] },
    })
    const inputs = wrapper.get('[data-testid="day-1"]').findAll('input[type="time"]')
    expect(inputs).toHaveLength(4)
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('09:00')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('13:00')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('14:00')
    expect((inputs[3]!.element as HTMLInputElement).value).toBe('20:00')
  })

  it('hides the remove-range button while a day has only one range', () => {
    const wrapper = mountStep({ 1: { enabled: true, ranges: [{ openTime: '09:00', closeTime: '20:00' }] } })
    expect(wrapper.get('[data-testid="day-1"]').find('[data-testid="remove-range"]').exists()).toBe(false)
  })

  it('adds a new range after the day\'s last one on "افزودن بازه", enabling a lunch-break split shift', async () => {
    const wrapper = mountStep({ 1: { enabled: true, ranges: [{ openTime: '09:00', closeTime: '13:00' }] } })
    const day1 = wrapper.get('[data-testid="day-1"]')

    await day1.get('[data-testid="add-range"]').trigger('click')

    const inputs = day1.findAll('input[type="time"]')
    expect(inputs).toHaveLength(4)
    // The new range starts where the last one ended -- "confirm the times", not retype them.
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('13:00')
  })

  it('removes a range on its own remove button, leaving the other range intact', async () => {
    const wrapper = mountStep({
      1: { enabled: true, ranges: [{ openTime: '09:00', closeTime: '13:00' }, { openTime: '14:00', closeTime: '20:00' }] },
    })
    const day1 = wrapper.get('[data-testid="day-1"]')

    await day1.findAll('[data-testid="remove-range"]')[0]!.trigger('click')

    const inputs = day1.findAll('input[type="time"]')
    expect(inputs).toHaveLength(2)
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('14:00')
  })

  it('hides "افزودن بازه" while a day is disabled', () => {
    const wrapper = mountStep({ 1: { enabled: false, ranges: [{ openTime: '09:00', closeTime: '20:00' }] } })
    expect(wrapper.get('[data-testid="day-1"]').find('[data-testid="add-range"]').exists()).toBe(false)
  })
})
