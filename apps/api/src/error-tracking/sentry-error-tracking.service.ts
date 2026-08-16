import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ErrorTrackingContext, ErrorTrackingService } from './error-tracking.service';
import { redactExtra } from './redact-context';

/**
 * Real Sentry implementation of the `ErrorTrackingService` seam (see that file's own doc
 * comment). Only ever constructed when `ERROR_TRACKING_PROVIDER=sentry` (see
 * error-tracking.module.ts's factory) -- `Sentry.init()` runs once, here, in the
 * constructor, not as a main.ts-level side effect: by the time NestJS instantiates ANY
 * provider, `ConfigModule.forRoot()`'s dotenv loading has already populated
 * `process.env` (it runs as part of evaluating `AppModule`'s own `@Module()` decorator,
 * which happens before `NestFactory.create()` ever gets to instantiate a single
 * provider) -- so there's no import-ordering gymnastics to get right, unlike tracing.ts's
 * OTel bootstrap.
 *
 * `skipOpenTelemetrySetup: true` + `tracesSampleRate: 0`: this app already owns its own
 * OpenTelemetry SDK (tracing.ts) with its own tracer provider/context manager/exporter --
 * letting Sentry's Node SDK register a SECOND one (its default behavior) would fight the
 * existing setup. This class is error capture only, not a second tracing system.
 */
@Injectable()
export class SentryErrorTrackingService implements ErrorTrackingService {
  constructor(dsn: string) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.GIT_SHA,
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true,
    });
  }

  captureException(error: unknown, context: ErrorTrackingContext = {}): void {
    const err = error instanceof Error ? error : new Error(String(error));
    Sentry.captureException(err, {
      tags: { requestId: context.requestId, route: context.route },
      user: context.userId ? { id: context.userId } : undefined,
      extra: redactExtra(context.extra),
    });
  }
}
