import { Body, Controller, HttpCode, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import Redis from 'ioredis';
import { AlertsService } from '../alerts/alerts.service';
import { Public } from '../auth/public.decorator';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS } from '../redis/redis.module';
import { BackupReportDto } from './backup-report.dto';
import { BackupReportSecretGuard } from './backup-report-secret.guard';

// Durable "when did a backup last actually succeed" marker -- deliberately no TTL/EX,
// unlike every AlertsService dedup key. A dedup key's job is to expire so the SAME
// condition can re-alert later; this key's job is the opposite: to keep answering "how
// long ago" accurately for as long as nothing newer overwrites it, including across a
// stretch where backups are failing and nothing is refreshing it. Read by
// backup-staleness-check.job.ts. Exported so that job (and its spec) reference the exact
// same key rather than a second, driftable string literal.
export const BACKUP_LAST_SUCCESS_KEY = 'backup:last-success';

/**
 * Internal-only endpoint docker/backup/backup.sh POSTs to, best-effort, after every
 * dump+upload attempt (see that script's own comments for what "best-effort" means for
 * its exit code). Access control is BackupReportSecretGuard, not @Public() -- see that
 * guard's doc comment for why the shared secret is load-bearing here, not merely
 * defense-in-depth.
 */
@Controller()
@Public()
@UseGuards(BackupReportSecretGuard)
export class BackupReportController {
  private readonly logger = new Logger(BackupReportController.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
  ) {}

  @Post('internal/backup-report')
  @HttpCode(204)
  async report(@Body() body: BackupReportDto): Promise<void> {
    if (body.status === 'success') {
      this.metrics.observeBackupReport('success');
      await this.redis.set(BACKUP_LAST_SUCCESS_KEY, new Date().toISOString());
      this.logger.log(
        `Backup reported success` +
          (body.sizeBytes !== undefined ? ` (${body.sizeBytes} bytes)` : '') +
          (body.durationMs !== undefined ? ` in ${body.durationMs}ms` : ''),
      );
      return;
    }

    this.metrics.observeBackupReport('failure');
    this.logger.error(`Backup reported failure${body.error ? `: ${body.error}` : ''}`);
    await this.alerts.raise({
      key: 'backup-failed',
      severity: 'critical',
      title: 'پشتیبان‌گیری پایگاه‌داده ناموفق بود',
      body: body.error
        ? `اجرای پشتیبان‌گیری با خطا مواجه شد: ${body.error}`
        : 'اجرای پشتیبان‌گیری با خطا مواجه شد (جزئیات خطا ارسال نشده است).',
      // Re-page hourly while backups keep failing, same as cron-job-failed -- a broken
      // daily backup needs to stay loud until fixed, not go quiet for the default 6h.
      dedupHours: 1,
    });
  }
}
