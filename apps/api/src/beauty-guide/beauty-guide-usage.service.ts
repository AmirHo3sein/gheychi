import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { iranDateString, iranWallClockToInstant } from '../common/iran-time.util';
import { MetricsService } from '../metrics/metrics.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { REDIS } from '../redis/redis.module';

const ANALYSIS_LOCK_TTL_SEC = 90;

/**
 * Beauty Guide cost controls. Usage is counted from durable rows (guides whose analysis
 * actually reached the provider, `provider_called`), per Tehran calendar day -- the same
 * "count the log, don't keep a counter" approach as SalonSmsQuotaService, so a Redis flush
 * can't reset anyone's quota, and a guide served from the duplicate cache or rejected
 * before the provider call never consumes it.
 *
 * Count-then-call is not atomic on its own, so each user also holds a short Redis lock for
 * the duration of an analysis: one in-flight analysis per user, which bounds the per-user
 * race to zero. The global cap can be overshot by at most the number of concurrent users
 * in the same instant -- acceptable for a cost breaker. Fails CLOSED: if Redis is down the
 * lock can't be taken and the analysis is refused, because each call costs money.
 */
@Injectable()
export class BeautyGuideUsageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: PlatformConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /** Throws 429 when the user's or the platform's daily allowance is used up. */
  async assertWithinLimits(userId: string, now = new Date()): Promise<void> {
    const [perUser, global] = await Promise.all([
      this.config.getBeautyGuideDailyLimitPerUser(),
      this.config.getBeautyGuideDailyLimitGlobal(),
    ]);
    const { start, end } = this.tehranDay(now);
    const [row]: Array<{ mine: string; total: string }> = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE user_id = $1) AS mine, COUNT(*) AS total
         FROM beauty_guides
        WHERE provider_called AND analyzed_at >= $2 AND analyzed_at < $3`,
      [userId, start, end],
    );
    if (Number(row.mine) >= perUser) {
      this.metrics.incBeautyGuideLimitRejection('user');
      throw new HttpException(
        { message: 'سقف ساخت راهنمای زیبایی برای امروز پر شده است؛ فردا دوباره امتحان کنید.', code: 'BEAUTY_GUIDE_DAILY_LIMIT' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (Number(row.total) >= global) {
      this.metrics.incBeautyGuideLimitRejection('global');
      throw new HttpException(
        { message: 'ساخت راهنمای زیبایی موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کنید.', code: 'BEAUTY_GUIDE_GLOBAL_LIMIT' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Runs `fn` while holding the user's single in-flight analysis slot. */
  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const key = `beauty-guide:analysis-lock:${userId}`;
    const acquired = await this.redis.set(key, '1', 'EX', ANALYSIS_LOCK_TTL_SEC, 'NX');
    if (acquired !== 'OK') {
      throw new ConflictException('یک راهنمای زیبایی در حال آماده شدن است؛ لطفاً چند لحظه صبر کنید.');
    }
    try {
      return await fn();
    } finally {
      await this.redis.del(key).catch(() => {});
    }
  }

  private tehranDay(now: Date): { start: Date; end: Date } {
    const start = iranWallClockToInstant(iranDateString(now), 0);
    return { start, end: new Date(start.getTime() + 24 * 3600_000) };
  }
}
