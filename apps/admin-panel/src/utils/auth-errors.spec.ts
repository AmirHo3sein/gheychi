// apps/admin-panel/src/utils/auth-errors.spec.ts
import { describe, expect, it } from 'vitest'
import { CODE_REJECTED_MESSAGE, describeAuthError, formatCountdown } from './auth-errors'

const INVALID = 'شماره موبایل نامعتبر است'

describe('describeAuthError', () => {
  it('never reports a rate limit as bad input, and names the real window', () => {
    // The regression this guards: a 429 rendered as "your phone number is invalid" sends the
    // user off to fix a number that was correct, and they keep retrying into the same wall.
    const msg = describeAuthError({ status: 429, message: 'Too many OTP requests' }, INVALID)
    expect(msg).not.toBe(INVALID)
    expect(msg).toContain('یک ساعت')
  })

  it('never reports a dead network as bad input', () => {
    // status 0 is useApi's "no HTTP response at all" marker -- not a server verdict.
    const msg = describeAuthError({ status: 0, message: 'Network error' }, INVALID)
    expect(msg).not.toBe(INVALID)
    expect(msg).toContain('اتصال')
  })

  it('never reports a server fault as bad input', () => {
    const msg = describeAuthError({ status: 503, message: 'unavailable' }, INVALID)
    expect(msg).not.toBe(INVALID)
    expect(msg).toContain('سرور')
  })

  it('uses the invalid-input message only for genuine 4xx validation failures', () => {
    expect(describeAuthError({ status: 400, message: 'bad phone' }, INVALID)).toBe(INVALID)
  })

  it('never leaks the API\'s English strings into this Persian-only UI', () => {
    for (const status of [0, 400, 401, 429, 500, 503]) {
      const msg = describeAuthError({ status, message: 'Too many OTP requests' }, INVALID)
      expect(msg).not.toMatch(/[A-Za-z]{4,}/)
    }
  })

  it('names expiry as well as incorrectness, since the API 401 covers both', () => {
    // Saying only "wrong code" for an expired one makes the user retype correct-but-stale
    // digits and fail again with no hint that time ran out.
    expect(CODE_REJECTED_MESSAGE).toContain('منقضی')
  })
})

describe('formatCountdown', () => {
  it('renders mm:ss and zero-pads the seconds', () => {
    expect(formatCountdown(120)).toBe('2:00')
    expect(formatCountdown(65)).toBe('1:05')
    expect(formatCountdown(9)).toBe('0:09')
  })

  it('never renders a negative clock if the interval overshoots', () => {
    expect(formatCountdown(-5)).toBe('0:00')
  })
})
