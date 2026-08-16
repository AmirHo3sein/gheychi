import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_TRACKING_PROVIDER } from './error-tracking.service';
import { LoggerErrorTrackingService } from './logger-error-tracking.service';
import { SentryErrorTrackingService } from './sentry-error-tracking.service';

// Same interface -> injection-token -> implementation shape as SmsModule/PushModule (see
// CLAUDE.md's "External service abstractions" table). ERROR_TRACKING_PROVIDER=sentry
// requires SENTRY_DSN too (getOrThrow -- same fail-fast-on-misconfiguration posture as
// PAYMENT_GATEWAY=zarinpal requiring its own credentials, not a silent no-op). Defaults to
// the logger-only implementation, same as every other provider seam in this codebase.
@Module({
  providers: [
    {
      provide: ERROR_TRACKING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('ERROR_TRACKING_PROVIDER') === 'sentry'
          ? new SentryErrorTrackingService(config.getOrThrow('SENTRY_DSN'))
          : new LoggerErrorTrackingService(),
    },
  ],
  exports: [ERROR_TRACKING_PROVIDER],
})
export class ErrorTrackingModule {}
