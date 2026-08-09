import { describe, expect, it } from 'vitest'
import { validateWorkingHours, type TimeRange } from './working-hours'

function day(weekday: number, ranges: TimeRange[], enabled = true) {
  return { weekday, enabled, ranges }
}

function range(openTime: string, closeTime: string): TimeRange {
  return { openTime, closeTime }
}

describe('validateWorkingHours', () => {
  it('accepts a normal daytime range', () => {
    expect(validateWorkingHours([day(0, [range('09:00', '20:00')])])).toEqual({ message: '', invalid: [] })
  })

  it('accepts a lunch-break split shift (two non-overlapping ranges on the same day)', () => {
    expect(validateWorkingHours([day(0, [range('09:00', '13:00'), range('14:00', '20:00')])])).toEqual({
      message: '',
      invalid: [],
    })
  })

  it('rejects an overnight range -- PUT /salons/mine/hours 400s on openTime >= closeTime', () => {
    const result = validateWorkingHours([day(2, [range('20:00', '02:00')])])
    expect(result.invalid).toEqual([2])
    expect(result.message).toContain('سه‌شنبه')
    // The owner needs to know overnight hours aren't storable, not just that they typo'd.
    expect(result.message).toContain('بازه شبانه')
  })

  it('rejects an equal open/close time (a fat-fingered 09:00 to 09:00)', () => {
    expect(validateWorkingHours([day(5, [range('09:00', '09:00')])]).invalid).toEqual([5])
  })

  it('ignores disabled days, however nonsensical their times are', () => {
    expect(validateWorkingHours([day(0, [range('23:00', '01:00')], false), day(1, [range('09:00', '18:00')])])).toEqual({
      message: '',
      invalid: [],
    })
  })

  it('reports every offending weekday, by name', () => {
    const result = validateWorkingHours([
      day(0, [range('10:00', '09:00')]),
      day(1, [range('09:00', '18:00')]),
      day(6, [range('12:00', '12:00')]),
    ])
    expect(result.invalid).toEqual([0, 6])
    expect(result.message).toContain('یکشنبه، شنبه')
  })

  // The two ranges of a split shift are still submitted flat to PUT /salons/mine/hours (see
  // OnboardingView.vue / HoursView.vue's flatMap), and the API's own findOverlappingHourRanges
  // rejects any two SAME-weekday ranges that overlap -- this is that same rule, ported
  // client-side so the 400 is caught here instead of after the salon's already created.
  it('rejects two overlapping ranges on the same day', () => {
    const result = validateWorkingHours([day(3, [range('09:00', '13:00'), range('12:00', '17:00')])])
    expect(result.invalid).toEqual([3])
    expect(result.message).toContain('تداخل')
  })

  it('accepts back-to-back ranges on the same day that only touch at a shared boundary', () => {
    expect(validateWorkingHours([day(3, [range('09:00', '13:00'), range('13:00', '17:00')])])).toEqual({
      message: '',
      invalid: [],
    })
  })

  it('reports overlap even when a THIRD range is the one that overlaps, not the first pair', () => {
    const result = validateWorkingHours([day(4, [range('09:00', '11:00'), range('12:00', '14:00'), range('13:00', '15:00')])])
    expect(result.invalid).toEqual([4])
  })

  // Inverted-range detection runs first and returns early -- a day with BOTH problems still
  // gets one clear message instead of a confusing combined one.
  it('reports the inverted-range message before checking for overlaps, when a day has both problems', () => {
    const result = validateWorkingHours([day(2, [range('20:00', '02:00'), range('09:00', '13:00')])])
    expect(result.message).toContain('بازه شبانه')
    expect(result.message).not.toContain('تداخل')
  })
})
