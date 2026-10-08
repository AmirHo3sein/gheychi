import { describe, expect, it } from 'vitest'
import { endOfTehranDayIso, startOfTehranDayIso } from './tehran-day'

// Expected values are fixed instants, so these assertions hold under any machine TZ.
describe('tehran-day', () => {
  it('end of day is 23:59:59.999 Tehran time (UTC+03:30 since 2022)', () => {
    expect(endOfTehranDayIso('2026-10-12')).toBe('2026-10-12T20:29:59.999Z')
  })

  it('start of day is 00:00 Tehran time, i.e. 20:30 UTC the evening before', () => {
    expect(startOfTehranDayIso('2026-10-12')).toBe('2026-10-11T20:30:00.000Z')
  })

  it('uses the historical DST offset (+04:30) for summer dates before 2022', () => {
    expect(startOfTehranDayIso('2021-07-01')).toBe('2021-06-30T19:30:00.000Z')
    expect(endOfTehranDayIso('2021-07-01')).toBe('2021-07-01T19:29:59.999Z')
  })

  it('uses the standard offset (+03:30) for winter dates before 2022', () => {
    expect(startOfTehranDayIso('2021-12-01')).toBe('2021-11-30T20:30:00.000Z')
  })

  it('a start/end pair spans exactly one day', () => {
    const span = Date.parse(endOfTehranDayIso('2026-01-15')) - Date.parse(startOfTehranDayIso('2026-01-15'))
    expect(span).toBe(24 * 3600 * 1000 - 1)
  })
})
