import * as Sentry from '@sentry/vue'
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/vue'
import type { App } from 'vue'

/**
 * Browser-side crash reporting for the customer app. Wired by
 * `app/plugins/sentry.client.ts`; the logic lives here so it is testable as a plain
 * function (test/unit/error-reporting.spec.ts) rather than only through a Nuxt plugin.
 *
 * Before this existed, a client-side crash in production was invisible: a failed hydration
 * or a thrown render error leaves the customer looking at a broken page while the Nitro
 * server logs nothing at all (it rendered fine), so the only signal was a customer
 * complaint. The API has had an equivalent seam for a while (apps/api/src/error-tracking/,
 * `ERROR_TRACKING_PROVIDER`); this is its frontend half.
 *
 * Three deliberate properties, mirroring the backend's own posture:
 *
 * 1. **Off by default, inert without a DSN.** An unset/blank `NUXT_PUBLIC_SENTRY_DSN`
 *    means `Sentry.init()` is never called at all -- not "called with a dead transport".
 *    Local dev, CI and `vitest` therefore behave exactly as they did before this file, and
 *    a deploy that forgets the DSN degrades to the pre-existing "no reporting" state
 *    rather than breaking the app. Same shape as `ERROR_TRACKING_PROVIDER` falling back to
 *    `LoggerErrorTrackingService`.
 *    Unlike the two panels (which bake `VITE_SENTRY_DSN` into a static bundle at build
 *    time), this app reads its DSN from `runtimeConfig.public` -- so flipping it on is an
 *    `.env` edit plus a container restart, with no rebuild.
 * 2. **Errors only, never tracing.** `tracesSampleRate: 0` and no
 *    `browserTracingIntegration` -- the API already owns distributed tracing through its
 *    own OpenTelemetry SDK (apps/api/src/tracing.ts; see `SentryErrorTrackingService`'s
 *    doc comment for why Sentry is deliberately not a second tracing system here). Browser
 *    transactions would join nothing on the backend side, at real per-event cost.
 * 3. **No PII, enforced twice.** `sendDefaultPii: false` stops the SDK volunteering IPs,
 *    cookies and request bodies in the first place, and `scrubEvent`/`scrubBreadcrumb`
 *    below strip what could still carry a phone number, OTP or JWT even with that off (a
 *    query string, a captured request body, a `console.log` argument). The `session`
 *    cookie is HttpOnly and unreadable from JS, so it cannot leak through this path at
 *    all -- but the scrub is written not to depend on that.
 *
 * A Sentry DSN is **not a secret**: it only authorizes event ingestion into one project,
 * which is why shipping it to the browser is the intended usage rather than a leak.
 */

/**
 * Query strings and fragments are the one part of a URL in this app that can carry a real
 * identifier (`/login?phone=…`, a future `?token=`). Paths themselves are route templates
 * plus opaque slugs/ids -- exactly the context that makes a report useful -- so only the
 * `?`/`#` tail is dropped.
 */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * Last-line scrub applied to every outgoing event. Written defensively against fields
 * nothing currently populates -- the point is that a *future* call site which starts
 * attaching request data can't silently turn this into a PII pipe.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
    // `data` is the request *body* -- an OTP verify posts the code itself in there.
    delete event.request.data
    if (event.request.url) event.request.url = stripUrlQuery(event.request.url)
  }
  // Nothing here ever calls `Sentry.setUser()`, so anything on this field arrived from a
  // default integration rather than a considered decision -- drop it wholesale instead of
  // enumerating which subfields happen to be identifying.
  delete event.user
  return event
}

/**
 * Breadcrumbs are the sneaky half: they are collected automatically, and both the console
 * and fetch/xhr integrations record argument/URL text that can contain an OTP or a phone
 * number without any call site opting in.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // `console.log(otpResponse)` anywhere in a dependency would otherwise be attached
  // verbatim to the next error. Console breadcrumbs are worth little here anyway.
  if (breadcrumb.category === 'console') return null
  if (typeof breadcrumb.data?.url === 'string') {
    breadcrumb.data.url = stripUrlQuery(breadcrumb.data.url)
  }
  return breadcrumb
}

/**
 * Returns whether reporting was actually enabled, so the plugin stays a straight line and
 * the "stays uninitialized without a DSN" guarantee is directly assertable in a test.
 * `dsn` is trimmed here rather than at the call site because an unset env var reaches
 * `runtimeConfig.public` as `''`, and a whitespace-only value must read as "not
 * configured" rather than as a malformed DSN for `Sentry.init` to choke on.
 */
export function initErrorReporting(dsn: string, app: App): boolean {
  const trimmed = dsn.trim()
  if (trimmed === '') return false

  Sentry.init({
    app,
    dsn: trimmed,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
    beforeBreadcrumb: scrubBreadcrumb,
  })
  return true
}

/**
 * Nuxt's `app:error` fires for *every* fatal error including the ones this app raises on
 * purpose -- `createError({ statusCode: 404 })` on an unknown salon slug or blog post is
 * the single most common one, and it is a normal, expected outcome, not a crash. Reporting
 * those would bury real bugs under 404 noise and burn the event quota on crawler traffic,
 * so any error carrying a 4xx status is dropped and only 5xx/unclassified errors (the ones
 * that genuinely indicate broken code) are captured.
 */
export function shouldReportFatalError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode
  return !(typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500)
}

export function captureFatalError(error: unknown): void {
  if (!shouldReportFatalError(error)) return
  Sentry.captureException(error)
}
