import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { App } from 'vue'
import * as Sentry from '@sentry/vue'
import {
  captureFatalError,
  initErrorReporting,
  scrubBreadcrumb,
  scrubEvent,
  shouldReportFatalError,
  stripUrlQuery,
} from '../../app/utils/error-reporting'

// Never let a test reach the real SDK: `Sentry.init()` installs global handlers and a
// transport for the rest of the process, which would leak across files in the same worker.
vi.mock('@sentry/vue', () => ({ init: vi.fn(), captureException: vi.fn() }))

const initMock = vi.mocked(Sentry.init)
const captureMock = vi.mocked(Sentry.captureException)

// `vue` is not a direct dependency of this workspace (it arrives through `nuxt`), so it
// does not resolve in the node-environment `unit` project -- and it doesn't need to:
// Sentry.init is mocked below, so the app instance is only ever passed through, never used.
const fakeApp = {} as App

describe('initErrorReporting', () => {
  beforeEach(() => {
    initMock.mockClear()
    captureMock.mockClear()
  })

  // The load-bearing guarantee: local dev, CI and every other DSN-less environment must
  // behave exactly as they did before error reporting existed -- not "initialized with a
  // dead transport", but never initialized at all.
  it('does not initialize Sentry when the DSN is empty or whitespace', () => {
    for (const blank of ['', '   ']) {
      expect(initErrorReporting(blank, fakeApp)).toBe(false)
    }
    expect(initMock).not.toHaveBeenCalled()
  })

  it('initializes with tracing off and PII disabled when a DSN is present', () => {
    expect(initErrorReporting('https://public@sentry.example.com/1', fakeApp)).toBe(true)
    expect(initMock).toHaveBeenCalledTimes(1)
    expect(initMock.mock.calls[0]![0]).toMatchObject({
      dsn: 'https://public@sentry.example.com/1',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    })
  })
})

describe('stripUrlQuery', () => {
  it('drops the query string and fragment but keeps the path', () => {
    expect(stripUrlQuery('https://gheychi.co/login?phone=09121234567')).toBe('https://gheychi.co/login')
    expect(stripUrlQuery('https://gheychi.co/salons/x#token=abc')).toBe('https://gheychi.co/salons/x')
    expect(stripUrlQuery('https://gheychi.co/salons/x')).toBe('https://gheychi.co/salons/x')
  })
})

describe('scrubEvent', () => {
  it('removes cookies, headers, body and query string, and never sends a user', () => {
    const scrubbed = scrubEvent({
      type: undefined,
      request: {
        url: 'https://gheychi.co/login?phone=09121234567',
        cookies: { session: 'jwt' },
        headers: { Authorization: 'Bearer jwt' },
        query_string: 'phone=09121234567',
        data: { code: '123456' },
      },
      user: { id: 'u1', ip_address: '1.2.3.4' },
    })

    expect(scrubbed.request).toEqual({ url: 'https://gheychi.co/login' })
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

describe('shouldReportFatalError', () => {
  // An unknown salon slug / blog post is a deliberate createError(404), not a crash --
  // reporting those would bury real bugs under crawler-driven 404 noise.
  it('ignores expected 4xx errors and reports everything else', () => {
    expect(shouldReportFatalError({ statusCode: 404 })).toBe(false)
    expect(shouldReportFatalError({ statusCode: 403 })).toBe(false)
    expect(shouldReportFatalError({ statusCode: 500 })).toBe(true)
    expect(shouldReportFatalError(new Error('boom'))).toBe(true)
    expect(shouldReportFatalError(null)).toBe(true)
  })

  it('captureFatalError forwards only reportable errors to Sentry', () => {
    captureMock.mockClear()
    captureFatalError({ statusCode: 404 })
    expect(captureMock).not.toHaveBeenCalled()
    const boom = new Error('boom')
    captureFatalError(boom)
    expect(captureMock).toHaveBeenCalledWith(boom)
  })
})
