import { describe, expect, it } from 'vitest'
import { validateWorkingHours } from './working-hours'

function day(weekday: number, openTime: string, closeTime: string, enabled = true) {
  return { weekday, openTime, closeTime, enabled }
}

describe('validateWorkingHours', () => {
  it('accepts a normal daytime range', () => {
    expect(validateWorkingHours([day(0, '09:00', '20:00')])).toEqual({ message: '', invalid: [] })
  })

  it('rejects an overnight range -- PUT /salons/mine/hours 400s on openTime >= closeTime', () => {
    const result = validateWorkingHours([day(2, '20:00', '02:00')])
    expect(result.invalid).toEqual([2])
    expect(result.message).toContain('سه‌شنبه')
    // The owner needs to know overnight hours aren't storable, not just that they typo'd.
    expect(result.message).toContain('بازه شبانه')
  })

  it('rejects an equal open/close time (a fat-fingered 09:00 to 09:00)', () => {
    expect(validateWorkingHours([day(5, '09:00', '09:00')]).invalid).toEqual([5])
  })

  it('ignores disabled days, however nonsensical their times are', () => {
    expect(validateWorkingHours([day(0, '23:00', '01:00', false), day(1, '09:00', '18:00')])).toEqual({
      message: '',
      invalid: [],
    })
  })

  it('reports every offending weekday, by name', () => {
    const result = validateWorkingHours([day(0, '10:00', '09:00'), day(1, '09:00', '18:00'), day(6, '12:00', '12:00')])
    expect(result.invalid).toEqual([0, 6])
    expect(result.message).toContain('یکشنبه، شنبه')
  })
})
