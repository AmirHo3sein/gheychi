import { Module } from '@nestjs/common';
import { ANALYTICS_PROVIDER } from './analytics.provider';
import { AnalyticsService } from './analytics.service';
import { ConsoleAnalyticsProvider } from './console-analytics.provider';

// Only ConsoleAnalyticsProvider exists today -- no real analytics vendor account
// exists in this environment. Mirrors SmsModule/PushModule's own registration shape
// (a plain object provider bound to the injection token) so a real vendor later
// slots in the exact same way those did: swap this single `provide` entry for a
// useFactory that picks the vendor implementation by config, the way
// SmsModule/PushModule already gate Kavenegar/WebPush behind an env var.
@Module({
  providers: [AnalyticsService, { provide: ANALYTICS_PROVIDER, useClass: ConsoleAnalyticsProvider }],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
