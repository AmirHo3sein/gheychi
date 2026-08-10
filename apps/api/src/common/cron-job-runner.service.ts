import { Inject, Injectable, Logger } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { ERROR_TRACKING_PROVIDER, ErrorTrackingService } from '../error-tracking/error-tracking.service';
import { MetricsService } from '../metrics/metrics.service';
import { CronLockService } from './cron-lock.service';

// Most jobs run every 1-5 minutes; anything still running past this on that cadence is
// worth a heads-up before it becomes a full-blown incident. Purely informational --
// raising it never affects the job's own execution or the distributed lock.
const DEFAULT_WARN_AFTER_MS = 2 * 60_000;

export interface CronJobRunOptions {
  /** Forwarded to CronLockService.runExclusive -- override for a job whose worst-case
   *  runtime could plausibly exceed the default lock TTL (see cron-lock.service.ts). */
  lockTtlMs?: number;
  /** How long the job may run before a one-time "still running" warning alert fires.
   *  Does NOT cancel or time out the job -- see class doc. */
  warnAfterMs?: number;
}

/**
 * The standard shape every cron job in this codebase runs through: distributed mutual
 * exclusion (CronLockService) + started/completed/failed logging with duration + a
 * "this is taking unusually long" warning + operator alerting on failure.
 *
 * Before this existed, a job whose `run()` threw failed nearly silently: `@nestjs/schedule`
 * has no centralized handler for a rejected cron callback, so the failure surfaced (at
 * best) as a single Nest [ERROR] log line an operator would have to already be watching
 * for -- payment-reconciliation.job.ts and refund-retry.job.ts separately grew their own
 * ad hoc AlertsService calls for specific bad *rows*, but a failure of the *job itself*
 * (a bad migration, a dropped DB connection, a bug) paged no one, in any job.
 *
 * Deliberately NOT a cancellation mechanism: `warnAfterMs` fires an alert and keeps
 * waiting for the real `fn()` to settle -- it never rejects/abandons it. Racing a timeout
 * against `fn()` and moving on early would release the distributed lock while the original
 * run is still using the DB/HTTP connections in the background, opening exactly the
 * duplicate-execution window this whole mechanism exists to close. True cancellation would
 * need an AbortSignal threaded through every job's DB/HTTP calls -- a much larger change,
 * tracked as follow-up work, not attempted here.
 */
@Injectable()
export class CronJobRunner {
  private readonly logger = new Logger(CronJobRunner.name);

  constructor(
    private readonly cronLock: CronLockService,
    private readonly alerts: AlertsService,
    @Inject(ERROR_TRACKING_PROVIDER) private readonly errorTracking: ErrorTrackingService,
    // Appended at the end, same convention as ReferralsService's own constructor
    // comment -- every existing positional `new CronJobRunner(...)` call site only
    // needs an arg added at the tail. The single most valuable wiring point for
    // background-job metrics in this codebase: every cron job in the app already
    // funnels through run() below, so this one class instruments all of them at once.
    private readonly metrics: MetricsService,
  ) {}

  async run(jobName: string, fn: () => Promise<void>, options: CronJobRunOptions = {}): Promise<void> {
    const warnAfterMs = options.warnAfterMs ?? DEFAULT_WARN_AFTER_MS;

    await this.cronLock.runExclusive(
      jobName,
      async () => {
        const startedAt = Date.now();
        this.logger.log(`Cron job "${jobName}" started`);
        const slowTimer = setTimeout(() => {
          this.alerts
            .raise({
              key: `cron-job-slow:${jobName}`,
              severity: 'warning',
              title: `کار زمان‌بندی‌شده «${jobName}» کندتر از حد انتظار است`,
              body: `اجرای این کار بیش از ${warnAfterMs}ms طول کشیده و هنوز در حال اجراست.`,
              dedupHours: 1,
            })
            .catch(() => {}); // raise() itself never throws; belt-and-braces only
        }, warnAfterMs);
        // A timer alone would keep the Node process alive until it fires -- harmless
        // here (the process is long-running anyway) but unref() is the correct default
        // for a fire-and-forget diagnostic timer.
        slowTimer.unref?.();

        try {
          await fn();
          clearTimeout(slowTimer);
          const durationMs = Date.now() - startedAt;
          this.logger.log(`Cron job "${jobName}" completed in ${durationMs}ms`);
          // Best-effort, see MetricsService's own doc comment. The single most
          // valuable metrics wiring point in this codebase -- every cron job funnels
          // through this one run() method.
          this.metrics.observeCronJob(jobName, 'success', durationMs / 1000);
        } catch (err) {
          clearTimeout(slowTimer);
          const durationMs = Date.now() - startedAt;
          this.metrics.observeCronJob(jobName, 'failure', durationMs / 1000);
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Cron job "${jobName}" failed after ${durationMs}ms: ${message}`,
            err instanceof Error ? err.stack : undefined,
          );
          // Best-effort capture alongside (not instead of) AlertsService.raise() below --
          // AlertsService pages an operator now; this feeds whatever error-tracking
          // backend eventually replaces LoggerErrorTrackingService with the full
          // exception/stack for later triage. No requestId/userId here -- a cron job has
          // neither; jobName/durationMs go in `extra` instead.
          this.errorTracking.captureException(err, { extra: { jobName, durationMs } });
          await this.alerts.raise({
            key: `cron-job-failed:${jobName}`,
            severity: 'critical',
            title: `اجرای کار زمان‌بندی‌شده «${jobName}» ناموفق بود`,
            body: `اجرای این کار پس از ${durationMs}ms با خطا مواجه شد: ${message}`,
            // Re-page hourly, not the default 6h -- a genuinely broken job keeps
            // failing every subsequent tick and needs to stay loud until fixed.
            dedupHours: 1,
          });
          // Deliberately not rethrown -- see class doc.
        }
      },
      options.lockTtlMs,
    );
  }
}
