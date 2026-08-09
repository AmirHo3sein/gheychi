import { describe, it, expect } from 'vitest'
import { pickDefaultDate, formatSlotTime } from '../../app/utils/slot-format'

describe('pickDefaultDate', () => {
  it('picks the first date that has at least one slot', () => {
    const days = [
      { date: '2026-07-10', slots: [] },
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
    ]
    expect(pickDefaultDate(days)).toBe('2026-07-11')
  })

  it('returns null when every day is empty', () => {
    expect(pickDefaultDate([{ date: '2026-07-10', slots: [] }])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickDefaultDate([])).toBeNull()
  })
})

describe('formatSlotTime', () => {
  it('formats an ISO instant as Tehran local HH:MM in Farsi digits', () => {
    // 09:00 UTC is 12:30 in Asia/Tehran (UTC+3:30)
    expect(formatSlotTime('2026-07-11T09:00:00.000Z')).toBe('۱۲:۳۰')
  })
})
