import { describe, it, expect } from 'vitest'
import { formatAppointment, formatDateShort, formatDateTime } from '../../app/utils/format-date'

// 2026-10-07T11:30:00Z is 15:00 in Asia/Tehran (UTC+3:30), Wednesday 15 Mehr 1405.
const ISO = '2026-10-07T11:30:00.000Z'

describe('format-date', () => {
  it('formatAppointment: weekday, date and hour:minute in Tehran time, no seconds', () => {
    expect(formatAppointment(ISO)).toBe('چهارشنبه ۱۵ مهر ۱۴۰۵ · ساعت ۱۵:۰۰')
  })

  it('formatDateShort: day, month name, year', () => {
    expect(formatDateShort(ISO)).toBe('۱۵ مهر ۱۴۰۵')
  })

  it('formatDateTime: short date plus hour:minute, no seconds', () => {
    expect(formatDateTime(ISO)).toBe('۱۵ مهر ۱۴۰۵ · ۱۵:۰۰')
  })

  it('uses Tehran time, not the runtime zone, across the day boundary', () => {
    // 21:00Z is 00:30 the NEXT day in Tehran.
    expect(formatDateTime('2026-10-07T21:00:00.000Z')).toBe('۱۶ مهر ۱۴۰۵ · ۰۰:۳۰')
  })

  it('returns an empty string for an unparseable value instead of throwing', () => {
    expect(formatAppointment('nope')).toBe('')
    expect(formatDateShort('nope')).toBe('')
    expect(formatDateTime('nope')).toBe('')
  })
})
