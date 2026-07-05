import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '../../app/utils/route-guard'

describe('isPublicRoute', () => {
  it('treats /login as public', () => {
    expect(isPublicRoute('/login')).toBe(true)
  })

  it('treats any /salons/:slug path as public', () => {
    expect(isPublicRoute('/salons/best-salon-tehran')).toBe(true)
  })

  it('treats home and account pages as private', () => {
    expect(isPublicRoute('/')).toBe(false)
    expect(isPublicRoute('/profile')).toBe(false)
    expect(isPublicRoute('/bookings')).toBe(false)
    expect(isPublicRoute('/admin/featured')).toBe(false)
  })

  it('does not treat /salons-something-else as public (no false-positive prefix match)', () => {
    expect(isPublicRoute('/salons-archive')).toBe(false)
  })
})
