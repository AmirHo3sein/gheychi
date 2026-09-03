import * as Sentry from '@sentry/vue'
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/vue'
import type { App } from 'vue'
import { buildEnv } from './build-env'

/**
 * Browser-side crash reporting for this panel.
 *
 * Before this existed, a client-side crash in production was completely invisible: this
 * app is a static SPA behind nginx, so a thrown render error leaves a blank page and
 * produces no server-side log line anywhere -- nobody finds out until an admin says
 * "the panel is broken". The API has had the same seam for a while
 * (apps/api/src/error-tracking/, `ERROR_TRACKING_PROVIDER`); this is its frontend half.
 *
 * Three deliberate properties, mirroring the backend's own posture:
 *
 * 1. **Off by default, inert without a DSN.** `VITE_SENTRY_DSN` unset/blank means
 *    `Sentry.init()` is never called at all -- not "called with a no-op transport". Local
 *    dev, CI, and `vitest` therefore behave exactly as they did before this file, and a
 *    deploy that forgets the DSN degrades to the pre-existing "no reporting" state rather
 *    than breaking the app. Same default-to-nothing shape as `ERROR_TRACKING_PROVIDER`
 *    falling back to `LoggerErrorTrackingService`.
 * 2. **Errors only, never tracing.** `tracesSampleRate: 0` and no
 *    `browserTracingIntegration` -- the API already owns distributed tracing through its
 *    own OpenTelemetry SDK (apps/api/src/tracing.ts, and see
 *    `SentryErrorTrackingService`'s doc comment for why Sentry is deliberately not a
 *    second tracing system in this codebase). A browser tracing integration here would
 *    produce transactions that join nothing, at real per-event cost.
 * 3. **No PII, enforced twice.** `sendDefaultPii: false` stops the SDK volunteering IPs,
 *    cookies and request bodies in the first place, and `scrubEvent`/`scrubBreadcrumb`
 *    below strip the categories that could still carry a phone number, OTP or JWT even
 *    with that off (a query string, a captured request body, a `console.log` argument).
 *    The `session` cookie itself is HttpOnly and unreadable from JS, so it cannot leak
 *    through this path at all -- but the scrub is written to not depend on that.
 *
 * Note that a Sentry DSN is **not a secret**: it only authorizes event ingestion into one
 * project, which is why baking it into a public browser bundle at build time (see this
 * app's Dockerfile `ARG VITE_SENTRY_DSN`) is the intended usage rather than a leak.
 */

/**
 * Query strings and fragments are the one part of a URL in this app that can carry a real
 * identifier (e.g. `?phone=` on a hand-typed support link, a `?token=` in some future
 * flow). Paths themselves are enumerable route templates plus opaque ids, which is exactly
 * the context that makes a report useful -- so only the `?`/`#` tail is dropped.
 */
export function stripUrlQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * Last-line scrub applied to every outgoing event. Written defensively against fields
 * nothing in this app currently populates -- the point is that a *future* call site that
 * starts attaching request data can't silently turn this into a PII pipe.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.query_string
    // `data` is the request *body* -- an OTP verify or a customer-SMS compose would put
    // real personal data straight into it.
    delete event.request.data
    if (event.request.url) event.request.url = stripUrlQuery(event.request.url)
  }
  // Nothing here ever calls `Sentry.setUser()`, so anything on this field arrived from a
  // default integration rather than a considered decision -- drop it wholesale instead of
  // enumerating which of its subfields happen to be identifying.
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
 * Reads the build-time DSN through the same `buildEnv` helper every other baked-in value
 * in this app goes through -- an unset CI repository variable expands to the empty string
 * and overrides the Dockerfile's ARG default, so `??` alone would hand `Sentry.init` a
 * blank/whitespace DSN to choke on instead of leaving reporting cleanly disabled.
 */
export function resolveSentryDsn(): string {
  return buildEnv(import.meta.env.VITE_SENTRY_DSN, '')
}

/**
 * Returns whether reporting was actually enabled, so `main.ts` stays a straight line and
 * the "stays uninitialized without a DSN" guarantee is directly assertable in a test.
 */
export function initErrorReporting(app: App): boolean {
  const dsn = resolveSentryDsn()
  if (dsn === '') return false

  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
    beforeBreadcrumb: scrubBreadcrumb,
  })
  return true
}
