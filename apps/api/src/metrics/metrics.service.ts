import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

/**
 * The single seam every metrics call site in this codebase talks to -- never
 * prom-client's process-wide default `register` or its metric constructors
 * directly, mirroring AnalyticsService/ErrorTrackingService's own "one seam per
 * cross-cutting concern" shape (see analytics.service.ts's doc comment).
 *
 * Owns its OWN Registry instance rather than prom-client's global default register,
 * specifically so that every NestJS test module that instantiates a fresh
 * MetricsService (there are many, across bookings/payments/coupons/wallet/referrals/
 * cron-job-runner specs) never collides with prom-client's "A metric with the name
 * ... has already been registered" error from a previous test file's still-live
 * default-register metrics. In production exactly one MetricsService instance ever
 * exists (it's provided by the @Global MetricsModule), so this has no effect on the
 * real /metrics endpoint beyond not depending on global mutable state.
 *
 * Every public method here is a best-effort observation: it must never be able to
 * throw or add meaningful latency to the real operation it's instrumenting. In
 * practice prom-client's Counter.inc()/Histogram.observe() cannot throw for the
 * fixed, code-controlled label sets used throughout this codebase, but every call
 * is still routed through `safe()` as belt-and-braces -- a metrics bug must never
 * be able to fail a booking, a payment, or any other real request.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  readonly registry = new Registry();

  private readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, labeled by method, matched route pattern, and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, labeled by method, matched route pattern, and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly bookingAttemptsTotal = new Counter({
    name: 'booking_attempts_total',
    help: 'Total booking creation attempts, before any validation',
    labelNames: ['flow'] as const,
    registers: [this.registry],
  });

  private readonly bookingSuccessesTotal = new Counter({
    name: 'booking_successes_total',
    help: 'Total bookings successfully created',
    labelNames: ['flow'] as const,
    registers: [this.registry],
  });

  private readonly bookingFailuresTotal = new Counter({
    name: 'booking_failures_total',
    help: 'Total booking creation attempts that failed, labeled by a bounded reason code',
    labelNames: ['flow', 'reason'] as const,
    registers: [this.registry],
  });

  private readonly bookingCancellationsTotal = new Counter({
    name: 'booking_cancellations_total',
    help: 'Total bookings cancelled, labeled by who cancelled it',
    labelNames: ['cancelled_by'] as const,
    registers: [this.registry],
  });

  private readonly bookingCompletionsTotal = new Counter({
    name: 'booking_completions_total',
    help: 'Total bookings marked completed',
    registers: [this.registry],
  });

  private readonly bookingNoShowsTotal = new Counter({
    name: 'booking_no_shows_total',
    help: 'Total bookings marked no-show',
    registers: [this.registry],
  });

  private readonly paymentAttemptsTotal = new Counter({
    name: 'payment_attempts_total',
    help: 'Total payment gateway callback resolution attempts, labeled by gateway',
    labelNames: ['gateway'] as const,
    registers: [this.registry],
  });

  private readonly paymentSuccessesTotal = new Counter({
    name: 'payment_successes_total',
    help: 'Total payments successfully captured, labeled by gateway',
    labelNames: ['gateway'] as const,
    registers: [this.registry],
  });

  private readonly paymentFailuresTotal = new Counter({
    name: 'payment_failures_total',
    help: 'Total payment attempts that failed or were declined, labeled by gateway',
    labelNames: ['gateway'] as const,
    registers: [this.registry],
  });

  private readonly paymentRefundsTotal = new Counter({
    name: 'payment_refunds_total',
    help: 'Total payment refunds actually issued, labeled by gateway',
    labelNames: ['gateway'] as const,
    registers: [this.registry],
  });

  private readonly couponValidationAttemptsTotal = new Counter({
    name: 'coupon_validation_attempts_total',
    help: 'Total coupon-code validation attempts (both the read-only preview and the real booking-time redemption)',
    registers: [this.registry],
  });

  private readonly couponRedemptionsTotal = new Counter({
    name: 'coupon_redemptions_total',
    help: 'Total coupon-code validations that succeeded (the code was accepted as usable)',
    registers: [this.registry],
  });

  private readonly couponRejectionsTotal = new Counter({
    name: 'coupon_rejections_total',
    help: 'Total coupon-code validations rejected, labeled by the bounded error code',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  private readonly referralEventsTotal = new Counter({
    name: 'referral_events_total',
    help: 'Total referral reward grant attempts, labeled by beneficiary role and outcome',
    labelNames: ['role', 'outcome'] as const,
    registers: [this.registry],
  });

  private readonly walletCreditsTotal = new Counter({
    name: 'wallet_credits_total',
    help: 'Total wallet credit movements, labeled by currency and transaction type',
    labelNames: ['currency', 'type'] as const,
    registers: [this.registry],
  });

  private readonly walletDebitsTotal = new Counter({
    name: 'wallet_debits_total',
    help: 'Total wallet debit movements that actually moved money (a zero-balance no-op debit is not counted), labeled by currency and transaction type',
    labelNames: ['currency', 'type'] as const,
    registers: [this.registry],
  });

  private readonly cronJobRunsTotal = new Counter({
    name: 'cron_job_runs_total',
    help: 'Total background job executions, labeled by job name and outcome',
    labelNames: ['job', 'outcome'] as const,
    registers: [this.registry],
  });

  private readonly cronJobDurationSeconds = new Histogram({
    name: 'cron_job_duration_seconds',
    help: 'Background job execution duration in seconds, labeled by job name',
    labelNames: ['job'] as const,
    registers: [this.registry],
  });

  private readonly backupReportsTotal = new Counter({
    name: 'backup_reports_total',
    help: 'Total backup completion reports received from docker/backup/backup.sh via POST /internal/backup-report, labeled by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  // Labeled ONLY by the violated directive (a small, fixed set of real CSP directive
  // names -- 'script-src', 'img-src', etc, never the reported blocked-uri/document-uri,
  // which are arbitrary and unbounded) -- see the standing "avoid high-cardinality
  // metrics" rule. Full report bodies still get logged (not just counted) by
  // CspReportController for actual triage; this counter is only the "is this getting
  // worse" trend signal.
  private readonly cspViolationsTotal = new Counter({
    name: 'csp_violations_total',
    help: 'Total Content-Security-Policy violation reports received, labeled by the violated directive',
    labelNames: ['directive'] as const,
    registers: [this.registry],
  });

  // Every public method below funnels through this -- see class doc for why. Logged
  // (not silently swallowed) so a genuine bug here is still discoverable, but never
  // rethrown: metrics observation must never be able to fail the real operation.
  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.error(`Metrics observation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.safe(() => {
      const labels = { method, route, status_code: String(statusCode) };
      this.httpRequestsTotal.inc(labels);
      this.httpRequestDurationSeconds.observe(labels, durationSeconds);
    });
  }

  incBookingAttempt(flow: 'online' | 'manual'): void {
    this.safe(() => this.bookingAttemptsTotal.inc({ flow }));
  }

  incBookingSuccess(flow: 'online' | 'manual'): void {
    this.safe(() => this.bookingSuccessesTotal.inc({ flow }));
  }

  incBookingFailure(flow: 'online' | 'manual', reason: string): void {
    this.safe(() => this.bookingFailuresTotal.inc({ flow, reason }));
  }

  incBookingCancellation(cancelledBy: 'user' | 'salon'): void {
    this.safe(() => this.bookingCancellationsTotal.inc({ cancelled_by: cancelledBy }));
  }

  incBookingCompletion(): void {
    this.safe(() => this.bookingCompletionsTotal.inc());
  }

  incBookingNoShow(): void {
    this.safe(() => this.bookingNoShowsTotal.inc());
  }

  incPaymentAttempt(gateway: string): void {
    this.safe(() => this.paymentAttemptsTotal.inc({ gateway }));
  }

  incPaymentSuccess(gateway: string): void {
    this.safe(() => this.paymentSuccessesTotal.inc({ gateway }));
  }

  incPaymentFailure(gateway: string): void {
    this.safe(() => this.paymentFailuresTotal.inc({ gateway }));
  }

  incPaymentRefund(gateway: string): void {
    this.safe(() => this.paymentRefundsTotal.inc({ gateway }));
  }

  incCouponValidationAttempt(): void {
    this.safe(() => this.couponValidationAttemptsTotal.inc());
  }

  incCouponRedemption(): void {
    this.safe(() => this.couponRedemptionsTotal.inc());
  }

  incCouponRejection(reason: string): void {
    this.safe(() => this.couponRejectionsTotal.inc({ reason }));
  }

  incReferralEvent(role: 'referrer' | 'referred' | 'unknown', outcome: 'granted' | 'failed'): void {
    this.safe(() => this.referralEventsTotal.inc({ role, outcome }));
  }

  incWalletCredit(currency: string, type: string): void {
    this.safe(() => this.walletCreditsTotal.inc({ currency, type }));
  }

  incWalletDebit(currency: string, type: string): void {
    this.safe(() => this.walletDebitsTotal.inc({ currency, type }));
  }

  observeCronJob(job: string, outcome: 'success' | 'failure', durationSeconds: number): void {
    this.safe(() => {
      this.cronJobRunsTotal.inc({ job, outcome });
      this.cronJobDurationSeconds.observe({ job }, durationSeconds);
    });
  }

  observeBackupReport(outcome: 'success' | 'failure'): void {
    this.safe(() => this.backupReportsTotal.inc({ outcome }));
  }

  // `directive` comes from a browser-submitted CSP violation report -- untrusted input,
  // not a code-controlled label like every other metric in this file. Normalized against
  // a fixed allowlist of real CSP directive names before it ever reaches a Prometheus
  // label, so a malformed or deliberately hostile report body can't mint unbounded label
  // values (a real cardinality-explosion vector, not a hypothetical one, for the one
  // metric in this codebase whose label touches request-supplied data).
  private static readonly KNOWN_CSP_DIRECTIVES = new Set([
    'default-src',
    'script-src',
    'script-src-elem',
    'script-src-attr',
    'style-src',
    'style-src-elem',
    'style-src-attr',
    'img-src',
    'font-src',
    'connect-src',
    'worker-src',
    'manifest-src',
    'frame-ancestors',
    'base-uri',
    'form-action',
    'object-src',
  ]);

  observeCspViolation(directive: string): void {
    const normalized = MetricsService.KNOWN_CSP_DIRECTIVES.has(directive) ? directive : 'other';
    this.safe(() => this.cspViolationsTotal.inc({ directive: normalized }));
  }
}
