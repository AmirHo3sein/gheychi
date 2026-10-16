import { describe, expect, it } from 'vitest'
import { addDaysToKey, gridBounds, minutesIntoDay, placeIntervals, rangeQuery, visibleDays, weekStartKey } from './booking-schedule'

describe('booking-schedule', () => {
  it('starts the week on Saturday', () => {
    // 2026-10-16 is a Friday -> its week opened Saturday the 10th.
    expect(weekStartKey('2026-10-16')).toBe('2026-10-10')
    expect(weekStartKey('2026-10-17')).toBe('2026-10-17') // a Saturday is its own start
    expect(visibleDays('week', '2026-10-13')).toEqual([
      '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
    ])
    expect(visibleDays('day', '2026-10-13')).toEqual(['2026-10-13'])
  })

  it('crosses month and year boundaries', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('asks the API for Tehran midnight to Tehran midnight', () => {
    expect(rangeQuery(['2026-10-12'])).toEqual({ from: '2026-10-11T20:30:00.000Z', to: '2026-10-12T20:30:00.000Z' })
    expect(rangeQuery(visibleDays('week', '2026-10-12'))).toEqual({ from: '2026-10-09T20:30:00.000Z', to: '2026-10-16T20:30:00.000Z' })
  })

  it('measures minutes from Tehran midnight', () => {
    // 09:00 Tehran = 05:30Z.
    expect(minutesIntoDay('2026-10-12T05:30:00.000Z', '2026-10-12')).toBe(540)
  })

  it('puts overlapping appointments side by side and leaves others full width', () => {
    const placed = placeIntervals([
      { id: 'a', start: 600, end: 660 },
      { id: 'b', start: 630, end: 690 },
      { id: 'c', start: 660, end: 720 }, // fits back into lane 0 after a ends
      { id: 'd', start: 800, end: 830 }, // its own cluster
    ])
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]))
    expect(byId.a).toMatchObject({ lane: 0, lanes: 2 })
    expect(byId.b).toMatchObject({ lane: 1, lanes: 2 })
    expect(byId.c).toMatchObject({ lane: 0, lanes: 2 })
    expect(byId.d).toMatchObject({ lane: 0, lanes: 1 })
  })

  it('widens the default frame to whole hours around every appointment', () => {
    expect(gridBounds([])).toEqual({ start: 540, end: 1260 })
    expect(gridBounds([{ start: 7 * 60 + 30, end: 8 * 60 }, { start: 22 * 60, end: 22 * 60 + 15 }])).toEqual({ start: 420, end: 1380 })
  })
})
