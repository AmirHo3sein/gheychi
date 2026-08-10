import { Injectable, Logger } from '@nestjs/common';
import { ErrorTrackingContext, ErrorTrackingService } from './error-tracking.service';
import { redactExtra } from './redact-context';

/**
 * Default (and, in this environment, only) `ErrorTrackingService` implementation: logs
 * one structured JSON line per captured exception through the existing Nest `Logger`, at
 * `error` level, under the `'ErrorTracking'` context tag -- searchable/parseable the same
 * way any other structured log line in this codebase is, and easy to grep out of
 * container logs in the meantime.
 *
 * This is deliberately NOT a real Sentry/APM SDK call -- no DSN/API key exists in this
 * environment. See `ErrorTrackingService`'s own doc comment in `./error-tracking.service.ts`
 * for the swap-in seam a real provider would use later.
 */
@Injectable()
export class LoggerErrorTrackingService implements ErrorTrackingService {
  private readonly logger = new Logger('ErrorTracking');

  captureException(error: unknown, context: ErrorTrackingContext = {}): void {
    const err = error instanceof Error ? error : new Error(String(error));
    const structured = {
      message: err.message,
      name: err.name,
      stack: err.stack,
      requestId: context.requestId,
      userId: context.userId,
      route: context.route,
      extra: redactExtra(context.extra),
    };
    this.logger.error(JSON.stringify(structured));
  }
}
