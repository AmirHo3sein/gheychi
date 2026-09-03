import RedisMock from 'ioredis-mock';
import Redis from 'ioredis';
import { acquireLock, releaseLockIfOwner } from './redis-lock.util';

// ioredis-mock runs the release script through a real Lua interpreter against real key
// state, so these assert the compare-and-delete's actual semantics, not a mock's calls.
describe('redis lock util', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = new RedisMock() as unknown as Redis;
    // ioredis-mock shares one keyspace across instances constructed the same way, so each
    // test has to start from a clean one or a previous test's lock leaks into this one.
    await redis.flushall();
  });

  it('acquires a free key and returns a token', async () => {
    const token = await acquireLock(redis, 'lock:x', 5000);

    expect(token).toEqual(expect.any(String));
    expect(await redis.get('lock:x')).toBe(token);
  });

  it('returns null (never throws) when the key is already held, leaving the holder untouched', async () => {
    const held = await acquireLock(redis, 'lock:x', 5000);

    expect(await acquireLock(redis, 'lock:x', 5000)).toBeNull();
    expect(await redis.get('lock:x')).toBe(held);
  });

  it('hands every acquisition its own distinct token', async () => {
    const a = await acquireLock(redis, 'lock:a', 5000);
    const b = await acquireLock(redis, 'lock:b', 5000);

    expect(a).not.toBe(b);
  });

  it('releases the key when the caller still owns it', async () => {
    const token = await acquireLock(redis, 'lock:x', 5000);

    await releaseLockIfOwner(redis, 'lock:x', token!);

    expect(await redis.get('lock:x')).toBeNull();
  });

  it('a release with a stale token does NOT delete the current holder lock', async () => {
    // The exact overrun scenario: caller A acquires, runs past its TTL (simulated here by
    // deleting the expired key), caller B legitimately acquires the same key, and only THEN
    // does A's `finally` fire. A's release must be a no-op -- deleting B's live lock would
    // admit a third concurrent run.
    const staleToken = await acquireLock(redis, 'lock:x', 5000);
    await redis.del('lock:x'); // A's lock expires
    const currentHolder = await acquireLock(redis, 'lock:x', 5000); // B acquires

    await releaseLockIfOwner(redis, 'lock:x', staleToken!); // A's late finally

    expect(await redis.get('lock:x')).toBe(currentHolder);
    expect(currentHolder).not.toBe(staleToken);
  });

  it('a release against a key nobody holds is a harmless no-op', async () => {
    await expect(releaseLockIfOwner(redis, 'lock:never-taken', 'some-token')).resolves.toBeUndefined();
  });
});
