import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { BackupReportController } from './backup-report.controller';
import { BackupReportSecretGuard } from './backup-report-secret.guard';
import { BackupStalenessCheckJob } from './backup-staleness-check.job';

// AlertsModule must be imported explicitly -- it is not itself @Global(), and CommonModule
// being @Global() only makes CommonModule's OWN providers (CronJobRunner, CronLockService)
// available everywhere, not the modules CommonModule happens to import (same reasoning
// CommonModule's own doc comment gives for importing AlertsModule itself). MetricsService,
// RedisModule's REDIS token, and CronJobRunner are all provided by modules that ARE
// @Global() (MetricsModule, RedisModule, CommonModule respectively), so nothing else is
// needed here -- same shape as booking.module.ts's own imports list.
@Module({
  imports: [AlertsModule],
  controllers: [BackupReportController],
  providers: [BackupReportSecretGuard, BackupStalenessCheckJob],
})
export class BackupMonitoringModule {}
