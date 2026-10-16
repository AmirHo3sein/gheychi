import { describe, expect, it } from 'vitest'
import { labelIndices, monotonePath, niceScale, tehranNoon } from './chart'

describe('niceScale', () => {
  it('rounds the top of the axis up to a 1/2/2.5/5 step', () => {
    expect(niceScale(930_000)).toEqual({ max: 1_000_000, step: 250_000 })
    expect(niceScale(7)).toEqual({ max: 8, step: 2 })
  })

  it('never uses a fractional step for counts', () => {
    expect(niceScale(3, 4, true)).toEqual({ max: 4, step: 1 })
    expect(niceScale(1, 4, true)).toEqual({ max: 4, step: 1 })
  })

  it('still gives an all-zero series a visible scale', () => {
    expect(niceScale(0, 4, true)).toEqual({ max: 4, step: 1 })
  })

  it('always covers the largest value', () => {
    for (const v of [1, 3, 9, 11, 49, 51, 99, 101, 12_345, 987_654]) {
      expect(niceScale(v, 4, true).max).toBeGreaterThanOrEqual(v)
    }
  })
})

describe('monotonePath', () => {
  it('starts at the first point and ends at the last', () => {
    const d = monotonePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 5 }])
    expect(d.startsWith('M0,10')).toBe(true)
    expect(d.endsWith('20,5')).toBe(true)
  })

  it('never overshoots: a flat run between equal values stays flat', () => {
    const d = monotonePath([{ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }])
    // Every coordinate is an "x,y" pair; the y values are the odd-indexed numbers.
    const ys = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0])).filter((_, i) => i % 2 === 1)
    expect(ys.every((y) => y === 50)).toBe(true)
  })

  it('handles empty and single-point series', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 3, y: 4 }])).toBe('M3,4')
  })
})

describe('labelIndices', () => {
  it('includes both ends and spreads the rest', () => {
    expect(labelIndices(31, 5)).toEqual([0, 8, 15, 23, 30])
  })

  it('never asks for more labels than points', () => {
    expect(labelIndices(3, 10)).toEqual([0, 1, 2])
    expect(labelIndices(1, 5)).toEqual([0])
    expect(labelIndices(0, 5)).toEqual([])
  })
})

describe('tehranNoon', () => {
  it('lands on the same Tehran calendar day', () => {
    const d = tehranNoon('2026-10-16')
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d)).toBe('2026-10-16')
  })
})
