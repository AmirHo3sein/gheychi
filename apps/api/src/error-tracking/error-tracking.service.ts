export const ERROR_TRACKING_PROVIDER = 'ERROR_TRACKING_PROVIDER';

/**
 * Everything on this type is explicitly allow-listed as safe to hand to
 * `captureException` -- a request/job correlation id, an internal user id, and a
 * route/job label. `extra` is a free-form bag for anything else genuinely useful for
 * debugging (e.g. a booking id, a salon id, a job's batch size). It is run through
 * `redactExtra()` (see `./redact-context.ts`) before anything is logged, but that
 * redaction is a *defense-in-depth backstop*, not a license to put whatever's
 * convenient in `extra`.
 *
 * Never pass a JWT, session cookie, OTP code, card/payment credential, or any
 * password/secret value into `context` or `extra` -- see
 * docs/technical-overview/21-security.md for this codebase's secrets-handling stance.
 */
export interface ErrorTrackingContext {
  requestId?: string;
  userId?: string;
  route?: string;
  extra?: Record<string, unknown>;
}

/**
 * The seam for production error tracking (Sentry, or any other APM). No real
 * account/DSN exists in this environment, so the only implementation today
 * (`LoggerErrorTrackingService`) logs a structured JSON line through the existing
 * Nest `Logger` instead of calling out to a real SDK -- see `error-tracking.module.ts`.
 *
 * Swapping in real Sentry later means writing ONE new class that implements this same
 * interface (e.g. wrapping `@sentry/node`'s `captureException`/`Sentry.setContext`) and
 * pointing `error-tracking.module.ts`'s provider factory at it. Every call site
 * (`GlobalExceptionFilter`, `CronJobRunner`, and any future direct caller) stays
 * unchanged -- exactly the same swap-a-provider seam this codebase already uses for
 * `SmsProvider`, `PushProvider`, and `PaymentGateway` (see CLAUDE.md's "External
 * service abstractions" table).
 */
export interface ErrorTrackingService {
  captureException(error: unknown, context?: ErrorTrackingContext): void;
}
