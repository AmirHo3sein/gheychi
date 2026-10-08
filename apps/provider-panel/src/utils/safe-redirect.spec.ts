import { describe, expect, it } from 'vitest'
import { sanitizeRedirect } from './safe-redirect'

describe('sanitizeRedirect', () => {
  it('accepts in-app relative paths, including query strings', () => {
    expect(sanitizeRedirect('/bookings')).toBe('/bookings')
    expect(sanitizeRedirect('/customers/c1?tab=notes')).toBe('/customers/c1?tab=notes')
    expect(sanitizeRedirect('/')).toBe('/')
  })

  it('rejects protocol-relative, absolute and scheme URLs (open redirect)', () => {
    expect(sanitizeRedirect('//evil.com')).toBeNull()
    expect(sanitizeRedirect('/\\evil.com')).toBeNull()
    expect(sanitizeRedirect('https://evil.com')).toBeNull()
    expect(sanitizeRedirect('javascript:alert(1)')).toBeNull()
    expect(sanitizeRedirect('evil.com')).toBeNull()
    expect(sanitizeRedirect('/ok\n//evil.com')).toBeNull()
  })

  it('rejects non-strings, empties and a loop back to /login', () => {
    expect(sanitizeRedirect(undefined)).toBeNull()
    expect(sanitizeRedirect(null)).toBeNull()
    expect(sanitizeRedirect('')).toBeNull()
    expect(sanitizeRedirect(['/a', '/b'])).toBe('/a')
    expect(sanitizeRedirect('/login')).toBeNull()
    expect(sanitizeRedirect('/login?redirect=/x')).toBeNull()
  })
})
