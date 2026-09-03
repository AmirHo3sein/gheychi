import { randomUUID } from 'crypto';
import Redis from 'ioredis';

/**
 * The one implementation of "a Redis mutex with a TTL, released only by its owner",
 * shared by the per-salon booking lock (bookings.service.ts) and the cron lock
 * (cron-lock.service.ts). Both previously needed the same discipline; only the
 * booking lock had it, and the copy that didn't (the cron lock's blind `DEL`) was a
 * real correctness bug on financial jobs -- so this lives in one place rather than
 * being written twice.
 *
 * Ownership-aware release: DEL-ing a lock key unconditionally is unsafe once the lock has
 * any TTL, because the caller that set it can no longer tell whether the key it's about to
 * delete is still its own. If a caller's critical section runs past the TTL, Redis expires
 * the key on its own and a second caller can legitimately acquire it -- an unconditional
 * DEL from the FIRST caller's `finally` would then delete the SECOND caller's still-live
 * lock, letting a third caller in while the second is still working.
 * GET-then-compare-then-DEL from application code has the identical race one level up (the
 * key could be re-acquired by someone else between the GET and the DEL), so the compare
 * and the delete must happen as one atomic step on the Redis server -- hence EVAL.
 */
export const RELEASE_LOCK_IF_OWNER_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Acquires `key` for `ttlMs`, returning the caller's OWN random ownership token, or null
 * if someone else already holds it. The token is never a shared constant: it is what
 * `releaseLockIfOwner` later compares against, and two callers sharing a value would
 * defeat the whole check. Never throws on a lost race -- callers decide what losing means.
 */
export async function acquireLock(redis: Redis, key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return acquired ? token : null;
}

/**
 * Deletes `key` ONLY if it still holds the exact token `acquireLock` returned to this
 * caller. A caller whose lock already expired and was re-acquired by someone else simply
 * no-ops: its token no longer matches, so the script's GET check fails and the current
 * holder's still-live lock is left untouched.
 */
export async function releaseLockIfOwner(redis: Redis, key: string, token: string): Promise<void> {
  await redis.eval(RELEASE_LOCK_IF_OWNER_LUA, 1, key, token);
}
