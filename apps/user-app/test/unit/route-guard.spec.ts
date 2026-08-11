import { describe, it, expect } from 'vitest'
import { isPublicRoute } from '../../app/utils/route-guard'

describe('isPublicRoute', () => {
  it('treats /login as public', () => {
    expect(isPublicRoute('/login')).toBe(true)
  })

  it('treats any /salons/:slug path as public', () => {
    expect(isPublicRoute('/salons/best-salon-tehran')).toBe(true)
  })

  it('treats the home page as public', () => {
    // Real public discovery/marketing content (search, salon browsing, the site's own
    // OG/JSON-LD-carrying landing page) -- an unauthenticated visitor must be able to
    // land on it directly, not get bounced to /login first.
    expect(isPublicRoute('/')).toBe(true)
  })

  it('treats account pages as private', () => {
    expect(isPublicRoute('/profile')).toBe(false)
    expect(isPublicRoute('/bookings')).toBe(false)
    expect(isPublicRoute('/admin/featured')).toBe(false)
  })

  it('does not treat /salons-something-else as public (no false-positive prefix match)', () => {
    expect(isPublicRoute('/salons-archive')).toBe(false)
  })

  it('treats the blog index and articles as public', () => {
    expect(isPublicRoute('/blog')).toBe(true)
    expect(isPublicRoute('/blog/healthy-hair-tips')).toBe(true)
  })

  it('does not treat /blog-something-else as public (no false-positive prefix match)', () => {
    expect(isPublicRoute('/blog-archive')).toBe(false)
  })
})
