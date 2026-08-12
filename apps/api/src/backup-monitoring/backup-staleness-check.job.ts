import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { REDIS } from '../redis/redis.module';
import { BACKUP_LAST_SUCCESS_KEY } from './backup-report.controller';

// docker/backup/backup.sh runs once daily (03:00 UTC cron) plus once on container start,
// so one full cycle is 24h. The threshold below adds a buffer ON TOP of that single
// cycle -- not a tight multiple of this job's own check cadence -- so a backup that's
// merely a little late (container restart jitter, a brief S3/network blip the very next
// cron tick would absorb on its own) doesn't page an operator for something that was
// always going to self-resolve within a few hours. 27h = 24h (one cycle) + 3h buffer.
// Anything past that really has gone a full day with no successful backup landing in S3.
const STALE_AFTER_HOURS = 27;

@Injectable()
export class BackupStalenessCheckJob {
  private readonly logger = new Logger(BackupStalenessCheckJob.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly alerts: AlertsService,
    private readonly jobRunner: CronJobRunner,
  ) {}

  // Every 4 hours, not every 5 minutes like the money-critical payment jobs -- backups
  // are daily, so sub-hour precision buys nothing. But this must still catch a FULLY
  // SILENT failure (the whole backup container crash-looping and never even attempting
  // pg_dump, so it never reaches the point of calling POST /internal/backup-report at
  // all) well before the next scheduled 03:00 UTC run, not only after it's already a day
  // late. A 4-hour tick adds at most ~4h of detection lag on top of STALE_AFTER_HOURS --
  // a small fraction of the 24h cycle it's guarding -- while still only running 6
  // times/day.
  @Cron('0 */4 * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('backup-staleness-check', async () => {
      await this.run();
    });
  }

  async run(): Promise<'ok' | 'missing' | 'stale'> {
    const lastSuccess = await this.redis.get(BACKUP_LAST_SUCCESS_KEY);

    if (!lastSuccess) {
      this.logger.error('No backup success has ever been reported (backup:last-success is missing in Redis)');
      await this.alerts.raise({
        key: 'backup-stale',
        severity: 'critical',
        title: 'هیچ پشتیبان‌گیری موفقی ثبت نشده است',
        body: 'تاکنون هیچ گزارش موفقیت‌آمیزی از سرویس پشتیبان‌گیری پایگاه‌داده دریافت نشده است.',
      });
      return 'missing';
    }

    const lastSuccessAt = new Date(lastSuccess);
    if (Number.isNaN(lastSuccessAt.getTime())) {
      // Treated the same as "missing" -- a corrupted value is just as blind a spot as no
      // value at all, and must not silently be read as "recent" (e.g. via `new Date(NaN)`
      // arithmetic quietly producing NaN hoursSince, which is not > STALE_AFTER_HOURS).
      this.logger.error(`backup:last-success holds an unparseable value: ${JSON.stringify(lastSuccess)}`);
      await this.alerts.raise({
        key: 'backup-stale',
        severity: 'critical',
        title: 'مقدار آخرین پشتیبان‌گیری موفق نامعتبر است',
        body: `مقدار ذخیره‌شده برای زمان آخرین پشتیبان‌گیری موفق قابل تفسیر نیست: ${lastSuccess}`,
      });
      return 'missing';
    }

    const hoursSince = (Date.now() - lastSuccessAt.getTime()) / 3_600_000;
    if (hoursSince > STALE_AFTER_HOURS) {
      const roundedHours = Math.floor(hoursSince);
      this.logger.error(
        `Last successful backup was ${roundedHours}h ago, past the ${STALE_AFTER_HOURS}h staleness threshold`,
      );
      await this.alerts.raise({
        key: 'backup-stale',
        severity: 'critical',
        title: 'پشتیبان‌گیری پایگاه‌داده قدیمی شده است',
        body: `آخرین پشتیبان‌گیری موفق ${roundedHours} ساعت پیش انجام شده و از حد آستانه ${STALE_AFTER_HOURS} ساعت گذشته است. وضعیت سرویس پشتیبان‌گیری را بررسی کنید.`,
      });
      return 'stale';
    }

    return 'ok';
  }
}
