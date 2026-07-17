import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { SalonStory } from './salon-story.entity';

// Bounds one run's work; anything left over is picked up by the next hourly tick.
const CLEANUP_BATCH_SIZE = 200;

/**
 * Storage hygiene only -- story visibility is enforced by the read-time
 * `expires_at > now()` predicate, never by this job, so a missed run can delay
 * cleanup but can never make an expired story reappear or linger publicly.
 * 'removed' rows ride the same GC once they pass their natural expiry.
 */
@Injectable()
export class StoryCleanupJob {
  private readonly logger = new Logger(StoryCleanupJob.name);

  constructor(
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Cron('0 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const expired = await this.stories
      .createQueryBuilder('story')
      // Grace hour past expiry keeps a just-expired image fetchable for an admin
      // resolving a fresh report; an OPEN report pins the evidence indefinitely
      // (resolving or dismissing it releases the row to the next run).
      .where("story.expires_at < now() - interval '1 hour'")
      .andWhere("NOT EXISTS (SELECT 1 FROM reports r WHERE r.story_id = story.id AND r.status = 'open')")
      .orderBy('story.expires_at', 'ASC')
      .take(CLEANUP_BATCH_SIZE)
      .getMany();

    let deleted = 0;
    for (const story of expired) {
      // Per-row isolation: one bad row must not abort the rest of the batch.
      try {
        // Storage delete FIRST, row delete only on success -- inverted from the
        // interactive delete path on purpose: here the DB row is the GC tracking
        // record, so a failing storage backend leaves the row in place and
        // self-heals on a later run instead of silently orphaning the object.
        await this.storage.delete(story.storageKey);
        await this.stories.delete(story.id);
        deleted++;
      } catch (err) {
        this.logger.error(
          `Failed to clean up expired story ${story.id} (salon ${story.salonId}, key ${story.storageKey}) -- will retry next run`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
    return deleted;
  }
}
