import { Inject, Injectable, InternalServerErrorException, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, Repository } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { PlatformConfig } from './platform-config.entity';

// Config values only change via an explicit admin PATCH (set()/setMany() below), which
// write through (delete the cached entry) immediately after their DB write commits -- so
// in the common case (an edit made through the app) a read never observes a stale value
// at all. This TTL is a safety net, not the primary consistency mechanism: it bounds
// staleness for the rare case of a direct DB edit bypassing the app, or a future
// horizontally-scaled instance that hasn't been told about another instance's write.
const CACHE_TTL_SEC = 60;
const CACHE_KEY_PREFIX = 'platform-config:';

// Every key a live getter below can be asked for. Kept as one list so startup validation
// (onApplicationBootstrap) and the individual getters can never silently drift out of sync --
// adding a new getXxx() getter without adding its key here means it's NOT checked at boot,
// so treat this list as required maintenance whenever a new config-backed getter is added.
export const REQUIRED_PLATFORM_CONFIG_KEYS = [
  'deposit_percent',
  'deposit_min_toman',
  'cancellation_window_hours',
  'commission_percent',
  'booking_hold_ttl_minutes',
  'reminder_lead_hours',
  'review_edit_window_hours',
] as const;

@Injectable()
export class PlatformConfigService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Runs once, after every module has initialized (DB connection included) but before the
  // HTTP server starts accepting traffic -- a NestJS lifecycle hook throwing here rejects
  // NestFactory.create() in main.ts, so the process never reaches app.listen(). This turns
  // a missing required config row from "the first booking/availability/review request after
  // deploy 500s with a raw Error" into "the deploy itself fails loudly, before serving any
  // traffic at all."
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.repo.find({
      where: { key: In([...REQUIRED_PLATFORM_CONFIG_KEYS]) },
      select: ['key'],
    });
    const present = new Set(rows.map((row) => row.key));
    const missing = REQUIRED_PLATFORM_CONFIG_KEYS.filter((key) => !present.has(key));
    if (missing.length > 0) {
      throw new Error(
        `Missing required platform_config row(s): ${missing.join(', ')}. ` +
          'Seed these via the initial-schema migration (or an admin PATCH /admin/config call) before starting the API.',
      );
    }
  }

  private async getNumber(key: string): Promise<number> {
    // This getter sits on several of the app's hottest paths (booking creation and
    // cancellation, coupon validation, commission recording, review-edit-window checks --
    // some inside an open DB transaction/Redis lock), reading a table that only ever
    // changes via an explicit admin action. Caching turns "every booking hits Postgres
    // for deposit_percent" into "one Postgres read per key per cache window."
    const cacheKey = CACHE_KEY_PREFIX + key;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return Number(cached);

    const row = await this.repo.findOneBy({ key });
    // Defense-in-depth: onApplicationBootstrap already refuses to let the process start
    // without every required key present, so reaching this branch means a required row
    // was deleted directly against the database after a successful boot (outside the
    // app's own setMany()/set(), which never delete rows). A clear, typed NestJS
    // exception here still beats an unhandled raw Error turning into an opaque 500.
    if (!row) throw new InternalServerErrorException(`Missing platform_config key: ${key}`);
    await this.redis.set(cacheKey, String(row.value), 'EX', CACHE_TTL_SEC);
    return Number(row.value);
  }

  getDepositPercent(): Promise<number> {
    return this.getNumber('deposit_percent');
  }

  getDepositMinToman(): Promise<number> {
    return this.getNumber('deposit_min_toman');
  }

  getCancellationWindowHours(): Promise<number> {
    return this.getNumber('cancellation_window_hours');
  }

  getCommissionPercent(): Promise<number> {
    return this.getNumber('commission_percent');
  }

  getBookingHoldTtlMinutes(): Promise<number> {
    return this.getNumber('booking_hold_ttl_minutes');
  }

  getReminderLeadHours(): Promise<number> {
    return this.getNumber('reminder_lead_hours');
  }

  getReviewEditWindowHours(): Promise<number> {
    return this.getNumber('review_edit_window_hours');
  }

  listAll(): Promise<PlatformConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: number | string | boolean): Promise<void> {
    await this.repo.upsert({ key, value }, ['key']);
    // Invalidate rather than write-through: the cache is always repopulated FROM the DB
    // row on next read, so it can never drift from what set() actually persisted.
    await this.redis.del(CACHE_KEY_PREFIX + key);
  }

  /**
   * Bulk-updates existing config rows atomically. Every key in the batch must
   * already exist -- a typo'd key throws NotFoundException instead of silently
   * creating a permanent, unreachable row, and validation happens before any
   * write so a bad key never leaves earlier entries partially committed.
   */
  async setMany(entries: { key: string; value: number | string | boolean }[]): Promise<void> {
    const keys = entries.map((entry) => entry.key);
    const existingRows = await this.repo.find({ where: { key: In(keys) }, select: ['key'] });
    const existingKeys = new Set(existingRows.map((row) => row.key));
    const missingKeys = keys.filter((key) => !existingKeys.has(key));
    if (missingKeys.length) {
      throw new NotFoundException(`Unknown platform_config key(s): ${missingKeys.join(', ')}`);
    }

    await this.dataSource.transaction(async (em) => {
      for (const entry of entries) {
        await em.update(PlatformConfig, { key: entry.key }, { value: entry.value });
      }
    });
    await this.redis.del(...keys.map((key) => CACHE_KEY_PREFIX + key));
  }
}
