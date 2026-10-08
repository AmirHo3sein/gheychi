import { describe, it, expect } from 'vitest'
import { sanitizeRedirect, loginLocation } from '../../app/utils/safe-redirect'

describe('sanitizeRedirect', () => {
  it.each([
    '/bookings',
    '/booking/my-salon/abc?beautyGuideId=123&source=qr',
    '/salons/x#reviews',
    '/blog/post?page=2',
  ])('accepts the same-origin relative path %s', (p) => {
    expect(sanitizeRedirect(p)).toBe(p)
  })

  it.each([
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/a'],
    ['slash-backslash', '/\\evil.example'],
    ['backslash anywhere', '/a\\b'],
    ['absolute https', 'https://evil.example'],
    ['absolute http', 'http://evil.example/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['bare host', 'evil.example'],
    ['scheme smuggled in a query', '/ok?next=https://evil.example'],
    ['tab-stripped protocol-relative', '/\t/evil.example'],
    ['newline', '/a\nb'],
    ['empty', ''],
    ['login itself', '/login'],
    ['login with query', '/login?redirect=%2Fx'],
  ])('falls back to / for %s', (_name, value) => {
    expect(sanitizeRedirect(value)).toBe('/')
  })

  it('falls back to / for non-strings', () => {
    expect(sanitizeRedirect(undefined)).toBe('/')
    expect(sanitizeRedirect(null)).toBe('/')
    expect(sanitizeRedirect(['/a', '/b'])).toBe('/')
    expect(sanitizeRedirect(42)).toBe('/')
  })
})

describe('loginLocation', () => {
  it('encodes the full path including the query string', () => {
    expect(loginLocation('/booking/s/abc?beautyGuideId=1&x=2')).toBe(
      '/login?redirect=%2Fbooking%2Fs%2Fabc%3FbeautyGuideId%3D1%26x%3D2',
    )
  })

  it('is a bare /login when there is nothing safe or useful to remember', () => {
    expect(loginLocation()).toBe('/login')
    expect(loginLocation('/')).toBe('/login')
    expect(loginLocation('/login')).toBe('/login')
    expect(loginLocation('//evil.example')).toBe('/login')
  })
})
