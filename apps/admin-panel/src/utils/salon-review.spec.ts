import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CHECKLIST,
  DEFAULT_TILE_URL,
  externalMapUrl,
  fillTileUrl,
  groupWorkingHours,
  isChecklistComplete,
  tileForPoint,
} from './salon-review'

describe('approval checklist', () => {
  it('lists the five written review items', () => {
    expect(APPROVAL_CHECKLIST).toHaveLength(5)
    expect(APPROVAL_CHECKLIST.map((i) => i.label)).toContain('با شماره مالک تماس گرفته شد')
  })

  it('is complete only when every item is exactly true', () => {
    const all = Object.fromEntries(APPROVAL_CHECKLIST.map((i) => [i.key, true]))
    expect(isChecklistComplete(all)).toBe(true)
    expect(isChecklistComplete({})).toBe(false)
    expect(isChecklistComplete({ ...all, call: false })).toBe(false)
    const missing = { ...all }
    delete missing.photos
    expect(isChecklistComplete(missing)).toBe(false)
  })
})

describe('groupWorkingHours', () => {
  it('returns seven days starting Saturday, closed when no range exists', () => {
    const days = groupWorkingHours([])
    expect(days.map((d) => d.label)).toEqual(['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'])
    expect(days.every((d) => d.ranges.length === 0)).toBe(true)
  })

  it('accepts either dayOfWeek or weekday (0 = Sunday), trims seconds and sorts split shifts', () => {
    const days = groupWorkingHours([
      { dayOfWeek: 6, openTime: '14:00:00', closeTime: '20:00:00' },
      { weekday: 6, openTime: '09:00:00', closeTime: '13:00:00' },
      { dayOfWeek: 0, openTime: '10:00', closeTime: '12:00' },
    ])
    expect(days[0]!.ranges).toEqual([
      { open: '09:00', close: '13:00' },
      { open: '14:00', close: '20:00' },
    ])
    expect(days[1]!.ranges).toEqual([{ open: '10:00', close: '12:00' }])
  })

  it('treats an isClosed row as closed', () => {
    const days = groupWorkingHours([{ dayOfWeek: 1, openTime: '09:00', closeTime: '17:00', isClosed: true }])
    expect(days.find((d) => d.day === 1)!.ranges).toEqual([])
  })
})

describe('map preview geometry', () => {
  it('maps (0,0) to the centre of the zoom-1 grid with the pixel offset at a tile corner', () => {
    const t = tileForPoint(0, 0, 1)
    expect(t.x).toBe(1)
    expect(t.y).toBe(1)
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo(0)
  })

  it('finds the known OSM tile for central Tehran at zoom 16 with an in-tile offset', () => {
    const t = tileForPoint(35.6892, 51.389, 16)
    expect(t.x).toBe(42_123)
    expect(t.y).toBe(25_804)
    expect(t.offsetX).toBeGreaterThanOrEqual(0)
    expect(t.offsetX).toBeLessThan(256)
    expect(t.offsetY).toBeGreaterThanOrEqual(0)
    expect(t.offsetY).toBeLessThan(256)
  })

  it('fills any {z}/{x}/{y} template, so a different provider is configuration only', () => {
    expect(fillTileUrl(DEFAULT_TILE_URL, 16, 3, 4)).toBe('https://tile.openstreetmap.org/16/3/4.png')
    expect(fillTileUrl('https://tiles.example/{z}/{x}/{y}@2x.png', 1, 2, 3)).toBe('https://tiles.example/1/2/3@2x.png')
  })

  it('builds an external OSM link carrying the coordinates', () => {
    const url = externalMapUrl(35.7, 51.4)
    expect(url).toContain('mlat=35.7')
    expect(url).toContain('mlon=51.4')
  })
})
