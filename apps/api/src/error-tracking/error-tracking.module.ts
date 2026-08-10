import { Module } from '@nestjs/common';
import { ERROR_TRACKING_PROVIDER } from './error-tracking.service';
import { LoggerErrorTrackingService } from './logger-error-tracking.service';

// Same interface -> injection-token -> implementation shape as SmsModule/PushModule (see
// CLAUDE.md's "External service abstractions" table) -- minus an env-var selector, because
// there is currently only one implementation to select between (no real Sentry account
// exists in this environment). Adding a real provider later means adding a second class
// here and switching this factory the same way SmsModule does for SMS_PROVIDER; nothing
// else in the codebase needs to change.
@Module({
  providers: [{ provide: ERROR_TRACKING_PROVIDER, useClass: LoggerErrorTrackingService }],
  exports: [ERROR_TRACKING_PROVIDER],
})
export class ErrorTrackingModule {}
