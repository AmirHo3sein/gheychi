import { Global, Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ErrorTrackingModule } from '../error-tracking/error-tracking.module';
import { CronJobRunner } from './cron-job-runner.service';
import { CronLockService } from './cron-lock.service';

@Global()
@Module({
  // AlertsModule -> AdminNotificationsModule + SmsModule, neither of which depends on
  // CommonModule (directly or transitively) -- verified no import cycle. Same for
  // ErrorTrackingModule (self-contained, no further deps).
  imports: [AlertsModule, ErrorTrackingModule],
  providers: [CronLockService, CronJobRunner],
  exports: [CronLockService, CronJobRunner],
})
export class CommonModule {}
