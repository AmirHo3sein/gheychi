import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { REDIS } from '../src/redis/redis.module';
import { loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Audit finding 10: one admin typo used to be able to stop booking creation and prevent the
// API from booting. Each scenario is reproduced at the HTTP edge, then at the stored-value
// level (a row corrupted directly in the database must degrade, not brick).
describe('Admin config hardening (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;

  const patchConfig = (updates: unknown[]) =>
    request(app.getHttpServer()).patch('/api/admin/config').set('Cookie', adminCookie).send({ updates });

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    adminCookie = await loginAsAdmin(app, '09151250099');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects no_show_grace_minutes above 1440 or fractional, accepts 0 and 1440', async () => {
    await patchConfig([{ key: 'no_show_grace_minutes', value: 1441 }]).expect(400);
    await patchConfig([{ key: 'no_show_grace_minutes', value: 99999 }]).expect(400);
    await patchConfig([{ key: 'no_show_grace_minutes', value: 2.5 }]).expect(400);
    await patchConfig([{ key: 'no_show_grace_minutes', value: 0 }]).expect(200);
    await patchConfig([{ key: 'no_show_grace_minutes', value: 1440 }]).expect(200);
    await patchConfig([{ key: 'no_show_grace_minutes', value: 30 }]).expect(200);
  });

  it('refuses a number for a feature-flag key on the numeric endpoint and leaves the flag boolean', async () => {
    await patchConfig([{ key: 'feature_reviews_enabled', value: 1 }]).expect(400);
    const [row] = await ds.query(`SELECT value FROM platform_config WHERE key = 'feature_reviews_enabled'`);
    expect(row.value).toBe(true);
    await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
  });

  it('the flag endpoint rejects non-boolean values', async () => {
    for (const bad of [1, 'true', 'yes', null]) {
      await request(app.getHttpServer())
        .patch('/api/admin/feature-flags')
        .set('Cookie', adminCookie)
        .send({ reviewsEnabled: bad })
        .expect(400);
    }
  });

  it('an out-of-range grace value written straight to the database degrades instead of breaking reads', async () => {
    await ds.query(`UPDATE platform_config SET value = '99999'::jsonb WHERE key = 'no_show_grace_minutes'`);
    const redis = app.get<Redis>(REDIS);
    await redis.del('platform-config:no_show_grace_minutes');
    // The admin list (a read of every numeric key) and the public flag read still work.
    await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
    await ds.query(`UPDATE platform_config SET value = '30'::jsonb WHERE key = 'no_show_grace_minutes'`);
    await redis.del('platform-config:no_show_grace_minutes');
  });

  it('a non-boolean flag row written straight to the database fails closed (off) instead of 500ing the flag read', async () => {
    await ds.query(`UPDATE platform_config SET value = '1'::jsonb WHERE key = 'feature_coupons_enabled'`);
    const redis = app.get<Redis>(REDIS);
    await redis.del('platform-config:feature_coupons_enabled');
    const res = await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
    expect(res.body.couponsEnabled).toBe(false);
    await ds.query(`UPDATE platform_config SET value = 'true'::jsonb WHERE key = 'feature_coupons_enabled'`);
    await redis.del('platform-config:feature_coupons_enabled');
  });
});
