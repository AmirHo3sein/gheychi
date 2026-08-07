import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScheduleStep from './ScheduleStep.vue'

function mountStep() {
  return mount(ScheduleStep, {
    props: {
      modelValue: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        openTime: '09:00',
        closeTime: '20:00',
        enabled: false,
      })),
    },
  })
}

describe('ScheduleStep', () => {
  it('renders one row per weekday with both time fields', () => {
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
    const row = mountStep().get('[data-testid="day-0"]')

    expect(row.get('label').classes()).toContain('min-h-11')
    for (const input of row.findAll('input[type="time"]')) {
      expect(input.classes()).toContain('min-h-11')
    }
  })

  // Iran's week starts شنبه (Saturday), not یکشنبه (Sunday) -- rendering rows in stored-int
  // order (0=Sunday first) read as a foreign week to every Iranian user of this screen.
  it('renders the week starting from Saturday, ending on Friday', () => {
    const rows = mountStep().findAll('[data-testid^="day-"]')
    const renderedWeekdays = rows.map((r) => Number(r.attributes('data-testid')!.replace('day-', '')))
    expect(renderedWeekdays).toEqual([6, 0, 1, 2, 3, 4, 5])
  })
})
