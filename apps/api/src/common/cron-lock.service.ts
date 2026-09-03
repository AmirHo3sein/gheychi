import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { acquireLock, releaseLockIfOwner } from './redis-lock.util';

const DEFAULT_TTL_MS = 60_000;

/**
 * Ensures at most one horizontally-scaled API instance executes a given cron tick,
 * using the exact same Redis primitive already trusted for the per-salon booking
 * lock (bookings.service.ts): `SET cron-lock:{jobName} NX PX <ttl>` with a random
 * ownership token, released by the shared owner-checked compare-and-delete in
 * `redis-lock.util.ts`. A different key prefix (`cron-lock:` vs `lock:booking:`)
 * keeps this from ever colliding with that lock.
 *
 * The owner token is not decoration: a blind `DEL` here was a real bug. A run that
 * overruns `ttlMs` has already lost its lock to expiry, another replica can have
 * legitimately acquired it, and the overrunning replica's `finally` would then delete
 * that successor's live lock -- admitting a THIRD concurrent run of a financial job
 * (refund retry, invoice generation). With the token, an overrunning run's release is
 * a no-op and the successor keeps its lock for its full TTL.
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
    const token = await acquireLock(this.redis, lockKey, ttlMs);
    if (!token) return;
    try {
      await fn();
    } finally {
      await releaseLockIfOwner(this.redis, lockKey, token);
    }
  }
}
