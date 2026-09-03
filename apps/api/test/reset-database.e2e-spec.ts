import Redis from 'ioredis';
import { resetDatabase, testDataSource } from './utils/db';

/**
 * Regression test for the exact bug class that bit this session twice (OTP rate-limit
 * leakage, then PlatformConfigService cache leakage): resetDatabase() wipes Postgres but
 * silently leaving Redis untouched, so state written by an earlier e2e file leaks into a
 * later file's "fresh" run. Pins the fix (the whole-DB flushdb() in resetDatabase()) so a
 * future "optimization" back toward a narrower, prefix-scoped clear can't reintroduce it
 * without this test catching it immediately, instead of another multi-hour cross-file
 * debugging session.
 */
describe('resetDatabase (e2e infra)', () => {
  it('flushes Redis, not just Postgres', async () => {
    const redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: +(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    });
    await redis.set('reset-database-regression-probe', '1');
    expect(await redis.exists('reset-database-regression-probe')).toBe(1);

    await resetDatabase();

    expect(await redis.exists('reset-database-regression-probe')).toBe(0);
    await redis.quit();
  });

  it('drops and recreates the Postgres schema, seeding it via migrations', async () => {
    const ds = testDataSource();
    await ds.initialize();
    try {
      await ds.query(`CREATE TABLE reset_database_regression_probe (id int)`);
      await ds.query(`INSERT INTO reset_database_regression_probe (id) VALUES (1)`);

      await resetDatabase();

      // The ad-hoc table itself must be gone (schema was dropped and recreated), and a
      // real migration-seeded table must exist again (schema was actually re-migrated,
      // not just left empty).
      const [{ exists: probeTableExists }] = await ds.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reset_database_regression_probe') AS exists`,
      );
      expect(probeTableExists).toBe(false);

      const [{ exists: categoriesTableExists }] = await ds.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'service_categories') AS exists`,
      );
      expect(categoriesTableExists).toBe(true);
    } finally {
      await ds.destroy();
    }
  });
});
