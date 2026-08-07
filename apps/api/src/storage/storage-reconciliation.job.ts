import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider';

// Every prefix any upload site ever writes under (salon-photos.controller.ts,
// salon-portfolio.controller.ts, salon-stories.controller.ts all use `salons/...`;
// content.service.ts's blog covers use `blog/...`). Pass 2 only ever considers
// objects under these -- an unrecognized prefix is left alone rather than swept.
const KNOWN_PREFIXES = ['salons/', 'blog/'];
// An object newer than this is left alone even if no DB row references it yet --
// its owning INSERT may simply not have committed. Matches StoryCleanupJob's own
// storage-delete-before-DB-delete-then-self-heal reliability posture, just inverted
// (here it's "don't delete too early", not "don't leave an orphan behind").
const GRACE_PERIOD_MS = 24 * 60 * 60_000;
// Bounds one run's delete work; anything left over is picked up by the next hourly
// tick -- same shape as StoryCleanupJob's CLEANUP_BATCH_SIZE.
const DELETE_BATCH_SIZE = 500;
// Bounds one run's existence-check work the same way -- a real S3 HeadObject round
// trip per key, otherwise unbounded as the catalog of referenced keys grows.
// Leftover keys are simply re-checked on a later run (this pass is read-only, so
// there's no ordering/fairness requirement across runs).
const CHECK_BATCH_SIZE = 2000;
// Existence checks within a batch run in small concurrent groups rather than fully
// serially -- one-at-a-time network round trips is what made this pass slow to begin
// with.
const CHECK_CONCURRENCY = 20;

interface KnownKeyRow {
  storage_key: string;
}

export interface StorageReconciliationResult {
  missingObjectsLogged: number;
  orphansDeleted: number;
}

/**
 * Storage <-> DB cross-check, in two independent passes:
 *
 * 1. A DB row (salon_photos/portfolio_items/salon_stories/blog_posts) whose
 *    storage_key 404s in the backing store -- almost always a prior delete/upload
 *    failure that left a live reference to a missing file (a real, user-visible bug:
 *    the image 404s in the UI). Logged loudly for a human to look into; never
 *    auto-deleted -- a transient storage outage must not silently erase a customer's
 *    record of having uploaded something.
 * 2. A storage object under a known prefix with no DB row referencing it at all --
 *    deleted, but only once past a grace period, so an upload whose owning INSERT
 *    hasn't committed yet can never be raced.
 *
 * Runs hourly, matching StoryCleanupJob's cadence.
 */
@Injectable()
export class StorageReconciliationJob {
  private readonly logger = new Logger(StorageReconciliationJob.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly jobRunner: CronJobRunner,
  ) {}

  @Cron('0 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run(
      'storage-reconciliation',
      async () => {
        await this.run();
      },
      { lockTtlMs: 600_000, warnAfterMs: 300_000 },
    );
  }

  async run(): Promise<StorageReconciliationResult> {
    const knownKeys = await this.loadKnownKeys();
    const missingObjectsLogged = await this.reportMissingObjects(knownKeys);
    const orphansDeleted = await this.deleteOrphanedObjects(knownKeys);
    return { missingObjectsLogged, orphansDeleted };
  }

  /** Every storage_key any live row currently references, across all four owning tables. */
  private async loadKnownKeys(): Promise<Set<string>> {
    const rows: KnownKeyRow[] = await this.dataSource.query(`
      SELECT storage_key FROM salon_photos WHERE storage_key <> ''
      UNION ALL
      SELECT storage_key FROM portfolio_items
      UNION ALL
      SELECT storage_key FROM salon_stories
      UNION ALL
      SELECT cover_image_key AS storage_key FROM blog_posts WHERE cover_image_key IS NOT NULL
    `);
    return new Set(rows.map((r) => r.storage_key));
  }

  private async reportMissingObjects(knownKeys: Set<string>): Promise<number> {
    let missing = 0;
    const keys = Array.from(knownKeys).slice(0, CHECK_BATCH_SIZE);
    for (let i = 0; i < keys.length; i += CHECK_CONCURRENCY) {
      const chunk = keys.slice(i, i + CHECK_CONCURRENCY);
      const results = await Promise.all(chunk.map((key) => this.checkOneKey(key)));
      missing += results.filter(Boolean).length;
    }
    return missing;
  }

  private async checkOneKey(key: string): Promise<boolean> {
    try {
      if (await this.storage.exists(key)) return false;
      this.logger.error(`Storage object missing for a referenced key: ${key}`);
      return true;
    } catch (err) {
      // One bad key's existence check failing (transient storage error) must not
      // abort the rest of the pass -- same per-item isolation policy as every other
      // job in this codebase.
      this.logger.error(
        `Failed to check existence of storage key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async deleteOrphanedObjects(knownKeys: Set<string>): Promise<number> {
    const cutoff = Date.now() - GRACE_PERIOD_MS;
    let deleted = 0;
    for (const prefix of KNOWN_PREFIXES) {
      const objects = await this.storage.list(prefix);
      for (const obj of objects) {
        if (deleted >= DELETE_BATCH_SIZE) return deleted;
        if (knownKeys.has(obj.key)) continue;
        if (obj.lastModified.getTime() > cutoff) continue;
        try {
          await this.storage.delete(obj.key);
          deleted++;
        } catch (err) {
          this.logger.error(
            `Failed to delete orphaned storage object ${obj.key}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return deleted;
  }
}
