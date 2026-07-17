import { describe, expect, it } from 'vitest'
import { formatRemainingTime } from './remaining-time'

describe('formatRemainingTime', () => {
  const now = new Date('2026-07-17T12:00:00Z')

  it('formats whole hours with Persian digits', () => {
    expect(formatRemainingTime('2026-07-18T06:00:00Z', now)).toBe('۱۸ ساعت مانده')
  })

  it('rounds partial hours to the nearest hour', () => {
    expect(formatRemainingTime('2026-07-17T13:40:00Z', now)).toBe('۲ ساعت مانده')
  })

  it('switches to minutes below one hour', () => {
    expect(formatRemainingTime('2026-07-17T12:45:00Z', now)).toBe('۴۵ دقیقه مانده')
  })

  it('reports an already-passed timestamp as expired', () => {
    expect(formatRemainingTime('2026-07-17T11:59:00Z', now)).toBe('منقضی شده')
  })
})
