import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
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
  'booking_approval_timeout_minutes',
  'reminder_lead_hours',
  'review_edit_window_hours',
  'no_show_grace_minutes',
  // Abuse caps on one customer's active future bookings (overall / at a single salon).
  'booking_max_active_per_user',
  'booking_max_active_per_salon_per_user',
  // Beauty Guide cost controls (docs/superpowers/specs/2026-10-07-beauty-guide-design.md §7).
  // Customers have no subscription plan (entitlements are salon-scoped), so per-customer
  // AI usage limits live here rather than in the entitlement engine.
  'beauty_guide_daily_limit_per_user',
  'beauty_guide_daily_limit_global',
  'beauty_guide_retention_days',
] as const;

// Separate from REQUIRED_PLATFORM_CONFIG_KEYS/getNumber() on purpose: describeInvalidConfigValue
// coerces via Number(rawValue), which would silently "pass" a boolean (Number(true) === 1) without
// ever checking it's actually a boolean. These get their own list, their own boot check, and their
// own getter (getFeatureFlags()) instead of being folded into the numeric path.
export const FEATURE_FLAG_KEYS = [
  'feature_reviews_enabled',
  'feature_stories_enabled',
  'feature_portfolio_enabled',
  'feature_referrals_enabled',
  'feature_coupons_enabled',
  // Global kill switch for online (Zarinpal) payment collection. Seeded false -- launch
  // opens with every deposit collected in cash at the salon, matching pre-payment-gateway
  // behavior exactly. Both requiresPayment sites (BookingsService.createHold's own
  // computation and approve()'s re-derivation) AND this flag into their existing
  // deposit-based check, so flipping it off is equivalent to every booking landing on the
  // zero-deposit path that already exists -- no new booking status, no new code path.
  'feature_online_payment_enabled',
  // Beauty Guide (AI inspiration analysis). Seeded false: it calls a paid external AI
  // endpoint, so it must be switched on deliberately once that endpoint is configured
  // and reachable from the server.
  'feature_beauty_guide_enabled',
] as const;

export interface FeatureFlags {
  reviewsEnabled: boolean;
  storiesEnabled: boolean;
  portfolioEnabled: boolean;
  referralsEnabled: boolean;
  couponsEnabled: boolean;
  onlinePaymentEnabled: boolean;
  beautyGuideEnabled: boolean;
}

const FEATURE_FLAG_KEY_TO_FIELD: Record<(typeof FEATURE_FLAG_KEYS)[number], keyof FeatureFlags> = {
  feature_reviews_enabled: 'reviewsEnabled',
  feature_stories_enabled: 'storiesEnabled',
  feature_portfolio_enabled: 'portfolioEnabled',
  feature_referrals_enabled: 'referralsEnabled',
  feature_coupons_enabled: 'couponsEnabled',
  feature_online_payment_enabled: 'onlinePaymentEnabled',
  feature_beauty_guide_enabled: 'beautyGuideEnabled',
};

interface ConfigBounds {
  min: number;
  max: number | null;
}

// Mirrors admin-panel's ConfigView.vue boundsFor(): percent-shaped keys get a 0-100
// ceiling, every other key just gets a >= 0 floor. That frontend copy is UX-only (keeps an
// obviously-bad value off the confirm screen); this is the authoritative check -- enforced
// at startup below, and again as defense-in-depth inside getNumber() for a bad value written
// directly against the DB after a successful boot.
const PERCENT_KEYS = new Set<string>(['deposit_percent', 'commission_percent']);
// Timeout keys that drive a real deadline someone is shown and counts on. A 0 would expire
// every booking before a human could act on it; an unbounded value would let a request sit
// on a customer's slot indefinitely. Bounds deliberately identical to the per-salon
// override's own DTO + DB CHECK (1..1440), so the global default and a salon-level
// override of the SAME concept can never disagree about what a legal value is.
const MINUTE_TIMEOUT_KEYS = new Set<string>(['booking_approval_timeout_minutes', 'booking_hold_ttl_minutes']);
// How long after a booking's start a salon must wait before recording a no-show. 0 is
// deliberately legal (a platform that wants no grace at all), so this is not a
// MINUTE_TIMEOUT_KEY -- but it is capped at a day, past which the booking-completion
// window is long over anyway.
const GRACE_MINUTE_KEYS = new Set<string>(['no_show_grace_minutes']);
// Keys whose bad stored value DEGRADES instead of failing closed (boot or read). A grace
// period is a convenience window, not money: an out-of-range value must never be able to
// stop booking creation or prevent the API from booting, so it is clamped (a finite number)
// or replaced by the seeded default (anything else), and logged loudly. Money-shaped keys
// (deposit/commission/...) deliberately stay fail-closed.
const DEGRADABLE_KEY_FALLBACKS: Record<string, number> = { no_show_grace_minutes: 30 };
// Beauty Guide limits. Explicit ceilings (rather than the default unbounded >= 0) so a
// typo can't silently remove the cost breaker; 0 is legal and means "nobody can analyze".
// MUST stay identical to BEAUTY_GUIDE_CONFIG_BOUNDS in dto/admin-config.dto.ts -- a value
// the write path accepts but this read path rejects would brick the next boot.
export const BEAUTY_GUIDE_KEY_BOUNDS: Record<string, ConfigBounds> = {
  beauty_guide_daily_limit_per_user: { min: 0, max: 1000 },
  beauty_guide_daily_limit_global: { min: 0, max: 1_000_000 },
  beauty_guide_retention_days: { min: 1, max: 3650 },
};
// Booking abuse caps. MUST stay identical to BOOKING_LIMIT_CONFIG_BOUNDS in
// dto/admin-config.dto.ts -- a value the write path accepts but this read path rejects
// would brick the next boot. Minimum 1: a 0 cap would silently stop every online booking.
export const BOOKING_LIMIT_KEY_BOUNDS: Record<string, ConfigBounds> = {
  booking_max_active_per_user: { min: 1, max: 50 },
  booking_max_active_per_salon_per_user: { min: 1, max: 20 },
};
function boundsFor(key: string): ConfigBounds {
  if (BEAUTY_GUIDE_KEY_BOUNDS[key]) return BEAUTY_GUIDE_KEY_BOUNDS[key];
  if (BOOKING_LIMIT_KEY_BOUNDS[key]) return BOOKING_LIMIT_KEY_BOUNDS[key];
  if (PERCENT_KEYS.has(key)) return { min: 0, max: 100 };
  if (MINUTE_TIMEOUT_KEYS.has(key)) return { min: 1, max: 1440 };
  if (GRACE_MINUTE_KEYS.has(key)) return { min: 0, max: 1440 };
  return { min: 0, max: null };
}

// The value a degradable key resolves to when its stored value is invalid; null for a
// key that must fail closed instead.
function degradedValue(key: string, rawValue: unknown): number | null {
  if (!(key in DEGRADABLE_KEY_FALLBACKS)) return null;
  const numeric = Number(rawValue);
  const { min, max } = boundsFor(key);
  if (rawValue === null || rawValue === undefined || rawValue === '' || !Number.isFinite(numeric)) {
    return DEGRADABLE_KEY_FALLBACKS[key];
  }
  return Math.min(Math.max(Math.trunc(numeric), min), max ?? numeric);
}

// Returns a human-readable problem description if `rawValue` isn't a finite number within
// `key`'s bounds, or null if it's fine. Centralized so onApplicationBootstrap (startup) and
// getNumber (runtime defense-in-depth) can never validate a value inconsistently.
function describeInvalidConfigValue(key: string, rawValue: unknown): string | null {
  const numeric = Number(rawValue);
  if (rawValue === null || rawValue === undefined || rawValue === '' || !Number.isFinite(numeric)) {
    return `${key}=${JSON.stringify(rawValue)} is not a valid number`;
  }
  const { min, max } = boundsFor(key);
  if (numeric < min || (max !== null && numeric > max)) {
    return `${key}=${numeric} is out of bounds (expected ${min}..${max === null ? '∞' : max})`;
  }
  return null;
}

@Injectable()
export class PlatformConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformConfigService.name);

  constructor(
    @InjectRepository(PlatformConfig) private readonly repo: Repository<PlatformConfig>,
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Runs once, after every module has initialized (DB connection included) but before the
  // HTTP server starts accepting traffic -- a NestJS lifecycle hook throwing here rejects
  // NestFactory.create() in main.ts, so the process never reaches app.listen(). This turns
  // a missing OR malformed/out-of-bounds required config row from "the first
  // booking/availability/review request after deploy 500s (or silently misbehaves on a bad
  // number)" into "the deploy itself fails loudly, before serving any traffic at all."
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.repo.find({
      where: { key: In([...REQUIRED_PLATFORM_CONFIG_KEYS, ...FEATURE_FLAG_KEYS]) },
      select: ['key', 'value'],
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    const missing = REQUIRED_PLATFORM_CONFIG_KEYS.filter((key) => !byKey.has(key));
    const invalid: string[] = [];
    for (const key of REQUIRED_PLATFORM_CONFIG_KEYS.filter((k) => byKey.has(k))) {
      const problem = describeInvalidConfigValue(key, byKey.get(key));
      if (problem === null) continue;
      if (degradedValue(key, byKey.get(key)) !== null) {
        this.logger.error(`platform_config ${problem}; running with ${degradedValue(key, byKey.get(key))} until an admin fixes it.`);
      } else {
        invalid.push(problem);
      }
    }

    const missingFlags = FEATURE_FLAG_KEYS.filter((key) => !byKey.has(key));
    // A non-boolean flag row degrades to OFF (see getBoolean) rather than blocking boot.
    for (const key of FEATURE_FLAG_KEYS.filter((k) => byKey.has(k) && typeof byKey.get(k) !== 'boolean')) {
      this.logger.error(`platform_config ${key}=${JSON.stringify(byKey.get(key))} is not boolean; treating it as off until an admin fixes it.`);
    }

    if (missing.length === 0 && invalid.length === 0 && missingFlags.length === 0) {
      return;
    }

    const problems = [
      ...(missing.length > 0 ? [`Missing required platform_config row(s): ${missing.join(', ')}.`] : []),
      ...(invalid.length > 0 ? [`Invalid platform_config value(s): ${invalid.join('; ')}.`] : []),
      ...(missingFlags.length > 0 ? [`Missing required feature flag row(s): ${missingFlags.join(', ')}.`] : []),
    ];
    throw new Error(
      `${problems.join(' ')} ` +
        'Fix these platform_config row(s) via the initial-schema migration (or an admin PATCH ' +
        '/admin/config or /admin/feature-flags call) before starting the API.',
    );
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
    // without every required key present and valid, so reaching either branch below means a
    // required row was deleted or overwritten with a bad value directly against the database
    // after a successful boot (outside the app's own set()/setMany(), which validate keys and
    // -- for numeric config -- are themselves only ever fed already-validated values via the
    // admin config endpoints). A clear, typed NestJS exception here still beats an unhandled
    // raw Error (missing row) or a silently-wrong numeric result (malformed/out-of-bounds
    // value) turning into an opaque or subtly-incorrect 500.
    if (!row) throw new InternalServerErrorException(`Missing platform_config key: ${key}`);
    const problem = describeInvalidConfigValue(key, row.value);
    if (problem) {
      const degraded = degradedValue(key, row.value);
      if (degraded !== null) {
        this.logger.error(`platform_config ${problem}; using ${degraded} until an admin fixes it.`);
        await this.redis.set(cacheKey, String(degraded), 'EX', CACHE_TTL_SEC);
        return degraded;
      }
      throw new InternalServerErrorException(`Invalid platform_config value: ${problem}`);
    }
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

  /**
   * How long a customer has to pay once a booking enters pending_payment. Doubles as the
   * GLOBAL DEFAULT payment timeout for the manual-approval workflow -- deliberately reused
   * rather than forked into a second `booking_payment_timeout_minutes` key, since this key
   * already means exactly that and two keys for one concept would inevitably diverge.
   * A per-salon admin override lives on `salons.payment_timeout_minutes`.
   */
  getBookingHoldTtlMinutes(): Promise<number> {
    return this.getNumber('booking_hold_ttl_minutes');
  }

  /** Global default for how long a salon has to accept/decline a booking request. */
  getBookingApprovalTimeoutMinutes(): Promise<number> {
    return this.getNumber('booking_approval_timeout_minutes');
  }

  getReminderLeadHours(): Promise<number> {
    return this.getNumber('reminder_lead_hours');
  }

  getReviewEditWindowHours(): Promise<number> {
    return this.getNumber('review_edit_window_hours');
  }

  /**
   * How long after a booking's start time a salon must wait before it may record a
   * no-show. Platform-wide and admin-only on purpose: this is the customer's protection
   * against a salon forfeiting a deposit for an appointment that hasn't happened yet, so
   * the salon being protected against must not be able to set it (same reasoning that
   * keeps the approval/payment timeouts out of UpdateSalonDto).
   */
  getNoShowGraceMinutes(): Promise<number> {
    return this.getNumber('no_show_grace_minutes');
  }

  /** Most active (pending_approval/pending_payment/confirmed) future bookings one customer may hold. */
  getBookingMaxActivePerUser(): Promise<number> {
    return this.getNumber('booking_max_active_per_user');
  }

  /** Same, counted within a single salon. */
  getBookingMaxActivePerSalonPerUser(): Promise<number> {
    return this.getNumber('booking_max_active_per_salon_per_user');
  }

  getBeautyGuideDailyLimitPerUser(): Promise<number> {
    return this.getNumber('beauty_guide_daily_limit_per_user');
  }

  /** Platform-wide daily cap on AI analyses -- a cost circuit breaker, not a fairness rule. */
  getBeautyGuideDailyLimitGlobal(): Promise<number> {
    return this.getNumber('beauty_guide_daily_limit_global');
  }

  getBeautyGuideRetentionDays(): Promise<number> {
    return this.getNumber('beauty_guide_retention_days');
  }

  private async getBoolean(key: string): Promise<boolean> {
    const cacheKey = CACHE_KEY_PREFIX + key;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === '1';

    const row = await this.repo.findOneBy({ key });
    // Same defense-in-depth reasoning as getNumber(): onApplicationBootstrap already
    // refuses to start without every flag present and boolean-typed, so reaching either
    // branch below means a row was deleted/corrupted directly against the database after a
    // successful boot.
    if (!row) throw new InternalServerErrorException(`Missing platform_config key: ${key}`);
    // A corrupted flag fails CLOSED (off) with a loud log, never a 500 on every request that
    // reads flags. Not cached, so fixing the row takes effect immediately.
    if (typeof row.value !== 'boolean') {
      this.logger.error(`platform_config ${key}=${JSON.stringify(row.value)} is not boolean; treating it as off.`);
      return false;
    }
    await this.redis.set(cacheKey, row.value ? '1' : '0', 'EX', CACHE_TTL_SEC);
    return row.value;
  }

  // One batched call (parallel reads, still N Redis round trips today -- a single
  // multi-key cache entry would save nothing meaningful at 5 keys) so every call site reads
  // all 5 flags together instead of juggling 5 separate getters.
  async getFeatureFlags(): Promise<FeatureFlags> {
    const values = await Promise.all(FEATURE_FLAG_KEYS.map((key) => this.getBoolean(key)));
    const result = {} as FeatureFlags;
    FEATURE_FLAG_KEYS.forEach((key, i) => {
      result[FEATURE_FLAG_KEY_TO_FIELD[key]] = values[i];
    });
    return result;
  }

  // Scoped to the numeric keys only -- this is AdminConfigController's exclusive backing
  // (list + audit before/after snapshots), whose PATCH round-trips every row this returns
  // straight back through UpdateConfigDto's @IsNumber() validation. Before this scoping,
  // listAll() returned literally every platform_config row including the boolean
  // feature_*_enabled ones, which made that PATCH 400 on its very next save (a boolean
  // value failing @IsNumber()) -- caught by a real, reproducible admin-panel e2e failure
  // (02-moderation-and-money.spec.ts's platform-config step). Feature flags have their own
  // dedicated GET/PATCH /admin/feature-flags; nothing here should ever need to see them.
  listAll(): Promise<PlatformConfig[]> {
    return this.repo.find({ where: { key: In([...REQUIRED_PLATFORM_CONFIG_KEYS]) }, order: { key: 'ASC' } });
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
    // Type must match the row's kind: a number written into a flag row (or a boolean into
    // a numeric one) is exactly what used to brick the next boot.
    const flagKeys = new Set<string>(FEATURE_FLAG_KEYS);
    for (const entry of entries) {
      const isFlag = flagKeys.has(entry.key);
      if (isFlag && typeof entry.value !== 'boolean') {
        throw new BadRequestException(`"${entry.key}" is a feature flag and must be true or false`);
      }
      if (!isFlag && typeof entry.value === 'boolean') {
        throw new BadRequestException(`"${entry.key}" is numeric and cannot be set to a boolean`);
      }
    }
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

  // Partial update, field-named (reviewsEnabled, ...) rather than key-named -- callers
  // (the admin controller) shouldn't need to know the underlying platform_config key
  // strings, matching getFeatureFlags()'s own field-named return shape. Delegates to
  // setMany() for the same all-or-nothing validated write.
  async setFeatureFlags(entries: Partial<FeatureFlags>): Promise<void> {
    const fieldToKey = Object.fromEntries(
      FEATURE_FLAG_KEYS.map((key) => [FEATURE_FLAG_KEY_TO_FIELD[key], key]),
    ) as Record<keyof FeatureFlags, string>;
    const updates = Object.entries(entries)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ key: fieldToKey[field as keyof FeatureFlags], value: value as boolean }));
    if (updates.length === 0) return;
    await this.setMany(updates);
  }
}
