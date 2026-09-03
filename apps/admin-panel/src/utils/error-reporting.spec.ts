import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp } from 'vue'
import * as Sentry from '@sentry/vue'
import { initErrorReporting, scrubBreadcrumb, scrubEvent, stripUrlQuery } from './error-reporting'

// Never let a test reach the real SDK: `Sentry.init()` installs global handlers and a
// transport for the rest of the process, which would leak across files in the same worker.
vi.mock('@sentry/vue', () => ({ init: vi.fn() }))

const initMock = vi.mocked(Sentry.init)

function stubDsn(value: string | undefined) {
  vi.stubEnv('VITE_SENTRY_DSN', value as string)
}

describe('initErrorReporting', () => {
  beforeEach(() => {
    initMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The load-bearing guarantee: local dev, CI and every other DSN-less environment must
  // behave exactly as they did before error reporting existed -- not "initialized with a
  // dead transport", but never initialized at all.
  it('does not initialize Sentry when the DSN is unset', () => {
    stubDsn(undefined)
    expect(initErrorReporting(createApp({}))).toBe(false)
    expect(initMock).not.toHaveBeenCalled()
  })

  it('does not initialize Sentry when the DSN is empty or whitespace', () => {
    for (const blank of ['', '   ']) {
      stubDsn(blank)
      expect(initErrorReporting(createApp({}))).toBe(false)
    }
    expect(initMock).not.toHaveBeenCalled()
  })

  it('initializes with tracing off and PII disabled when a DSN is present', () => {
    stubDsn('https://public@sentry.example.com/1')
    expect(initErrorReporting(createApp({}))).toBe(true)
    expect(initMock).toHaveBeenCalledTimes(1)
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: 'https://public@sentry.example.com/1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    })
  })
})

describe('stripUrlQuery', () => {
  it('drops the query string and fragment but keeps the path', () => {
    expect(stripUrlQuery('https://admin.gheychi.co/login?phone=09121234567')).toBe(
      'https://admin.gheychi.co/login',
    )
    expect(stripUrlQuery('https://admin.gheychi.co/bookings#token=abc')).toBe(
      'https://admin.gheychi.co/bookings',
    )
    expect(stripUrlQuery('https://admin.gheychi.co/bookings')).toBe('https://admin.gheychi.co/bookings')
  })
})

describe('scrubEvent', () => {
  it('removes cookies, headers, body and query string, and never sends a user', () => {
    const scrubbed = scrubEvent({
      type: undefined,
      request: {
        url: 'https://admin.gheychi.co/login?phone=09121234567',
        cookies: { session: 'jwt' },
        headers: { Authorization: 'Bearer jwt' },
        query_string: 'phone=09121234567',
        data: { code: '123456' },
      },
      user: { id: 'u1', ip_address: '1.2.3.4' },
    })

    expect(scrubbed.request).toEqual({ url: 'https://admin.gheychi.co/login' })
    expect(scrubbed.user).toBeUndefined()
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs entirely', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'otp 123456' })).toBeNull()
  })

  it('strips the query string off fetch breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'fetch', data: { url: '/auth/verify?code=123456' } })).toEqual({
      category: 'fetch',
      data: { url: '/auth/verify' },
    })
  })
})
