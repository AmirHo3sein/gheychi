import { config } from 'dotenv';
config({ path: '.env.test' });
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

export function testDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    migrations: ['src/migrations/*.ts'],
  });
}

export async function resetDatabase(): Promise<void> {
  const ds = testDataSource();
  await ds.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ds.runMigrations();
  await ds.destroy();

  // Postgres resets to a genuinely fresh, migration-seeded state above, but Redis is a
  // separate store this never touched -- every e2e file shares one Redis instance across
  // the whole suite run (jest-e2e.json has no per-file isolation for it), so anything an
  // earlier file cached or rate-limited would otherwise silently leak into this file's
  // "fresh" run. Concretely: PlatformConfigService's Redis-backed cache
  // (platform-config.service.ts) caused exactly this -- an admin-config edit in one e2e
  // file was still being served, stale, to a later file whose Postgres row had already
  // reset back to the migration seed. Flushing here, once, in the one setup function every
  // e2e file already calls, is the actual fix -- not chasing every individual cached/
  // rate-limited key by hand in every file that happens to touch one (see otp:rl:ip:* in
  // auth-helper.ts for the narrower, now-largely-redundant version of that approach).
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: +(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  });
  await redis.flushdb();
  await redis.quit();
}

// The migration seeds feature_online_payment_enabled=false (a real production launch
// decision -- see docs/technical-overview/29-global-payment-toggle.md), so a fresh
// resetDatabase() leaves it off. Every e2e suite exercising the online-payment/deposit/
// gateway flow (the vast majority of the booking/payment/referral surface) was written
// against the pre-existing, always-on behavior and needs it explicitly turned on -- called
// once, right after resetDatabase(), by any file whose scenarios actually involve money
// moving online. Deliberately a raw DB write, not an authenticated admin PATCH round-trip:
// this is test setup, not something under test, and admin-feature-flags.e2e-spec.ts is the
// one place the real HTTP path (and the real migration-seeded default) gets exercised.
export async function enableOnlinePayments(): Promise<void> {
  const ds = testDataSource();
  await ds.initialize();
  await ds.query(`UPDATE platform_config SET value = 'true' WHERE key = 'feature_online_payment_enabled'`);
  await ds.destroy();
}
