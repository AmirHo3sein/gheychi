import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const DEFAULT_TTL_MS = 60_000;

/**
 * Ensures at most one horizontally-scaled API instance executes a given cron tick,
 * using the exact same Redis primitive already trusted for the per-salon booking
 * lock (bookings.service.ts): `SET cron-lock:{jobName} NX PX <ttl>`, released with
 * `DEL` in a `finally`. A different key prefix (`cron-lock:` vs `lock:booking:`)
 * keeps this from ever colliding with that lock.
 *
 * An instance that loses the race just skips this tick -- another instance is
 * already running it, or ran it recently -- no queuing, no retry. If the lock
 * holder crashes mid-run, the PX TTL self-heals the lock without needing the
 * `finally` to ever run.
 */
@Injectable()
export class CronLockService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async runExclusive(jobName: string, fn: () => Promise<void>, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const lockKey = `cron-lock:${jobName}`;
    const acquired = await this.redis.set(lockKey, '1', 'PX', ttlMs, 'NX');
    if (!acquired) return;
    try {
      await fn();
    } finally {
      await this.redis.del(lockKey);
    }
  }
}
