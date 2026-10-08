import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PRIVATE_IMAGE_STORE, PrivateImageStore } from './private-image.store';

const STALE_PROCESSING_MINUTES = 5;
const BATCH_SIZE = 500;

/**
 * Two housekeeping duties for private customer data:
 *  1. Fails guides stuck in `processing` (the request died mid-analysis) so the customer
 *     sees a retryable failure instead of a spinner forever.
 *  2. Retention: deletes guides older than `beauty_guide_retention_days` together with
 *     their private image -- EXCEPT a guide still attached to a booking that hasn't
 *     happened yet, which the salon may still need to look at.
 */
@Injectable()
export class BeautyGuideRetentionJob {
  private readonly logger = new Logger(BeautyGuideRetentionJob.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PRIVATE_IMAGE_STORE) private readonly privateStore: PrivateImageStore,
    private readonly config: PlatformConfigService,
    private readonly jobRunner: CronJobRunner,
  ) {}

  @Cron('17 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('beauty-guide-retention', async () => {
      await this.run();
    });
  }

  async run(now = new Date()): Promise<{ staleFailed: number; deleted: number }> {
    const staleRows: unknown[] = await this.dataSource.query(
      `UPDATE beauty_guides SET status = 'failed', failure_code = 'timeout', updated_at = now()
        WHERE status = 'processing' AND created_at < $1 RETURNING id`,
      [new Date(now.getTime() - STALE_PROCESSING_MINUTES * 60_000)],
    );

    const retentionDays = await this.config.getBeautyGuideRetentionDays();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600_000);
    const expired: Array<{ id: string; image_key: string }> = await this.dataSource.query(
      `SELECT g.id, g.image_key FROM beauty_guides g
        WHERE g.created_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.beauty_guide_id = g.id AND b.ends_at > $2
               AND b.status IN ('pending_approval', 'pending_payment', 'confirmed'))
        ORDER BY g.created_at ASC
        LIMIT ${BATCH_SIZE}`,
      [cutoff, now],
    );
    let deleted = 0;
    for (const row of expired) {
      await this.dataSource.query(`DELETE FROM beauty_guides WHERE id = $1`, [row.id]);
      deleted += 1;
      await this.privateStore.delete(row.image_key).catch((err) => {
        this.logger.error(`Failed to delete private image ${row.image_key} for expired guide ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    return { staleFailed: staleRows.length, deleted };
  }
}
