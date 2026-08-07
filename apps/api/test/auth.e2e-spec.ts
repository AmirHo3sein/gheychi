import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/redis/redis.module';
import { clearOtpIpRateLimit } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  const phone = '09121234567';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    redis = app.get<Redis>(REDIS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an invalid phone', () =>
    request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone: '12345' }).expect(400));

  it('issues an OTP', async () => {
    await clearOtpIpRateLimit(redis);
    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    expect(await redis.get(`otp:${phone}`)).toMatch(/^\d{6}$/);
  });

  it('reports the code TTL and the remaining resend budget to the client', async () => {
    // The three login screens render an expiry countdown and a "last resend" warning from
    // these fields. If they ever stop being returned the UI silently degrades to the old
    // behaviour (no expiry shown, and an unannounced hour-long lockout after 3 requests),
    // so the contract is asserted here rather than only in the service unit test.
    const fresh = '09121230099';
    await redis.del(`otp:rl:${fresh}`);
    await clearOtpIpRateLimit(redis);

    const first = await request(app.getHttpServer())
      .post('/api/auth/request-otp')
      .send({ phone: fresh })
      .expect(201);
    expect(first.body.expiresInSec).toBeGreaterThan(0);
    // Matches the TTL Redis actually applied, so the countdown can't drift from the real one.
    expect(first.body.expiresInSec).toBe(await redis.ttl(`otp:${fresh}`));
    expect(first.body.resendsRemaining).toBe(2);

    const second = await request(app.getHttpServer())
      .post('/api/auth/request-otp')
      .send({ phone: fresh })
      .expect(201);
    expect(second.body.resendsRemaining).toBe(1);

    const third = await request(app.getHttpServer())
      .post('/api/auth/request-otp')
      .send({ phone: fresh })
      .expect(201);
    expect(third.body.resendsRemaining).toBe(0);

    // The budget the client was told about is the one the limiter actually enforces.
    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone: fresh }).expect(429);
  });

  it('rejects a wrong code', () =>
    request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code: '000000' })
      .expect(401));

  it('verifies, sets an HttpOnly session cookie, and creates the user', async () => {
    const code = await redis.get(`otp:${phone}`);
    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code })
      .expect(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.phone).toBe(phone);

    const cookie = res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie!)
      .expect(200);
    expect(me.body.phone).toBe(phone);
    expect(me.body.role).toBe('customer');
  });

  it('completes the profile (name + gender)', async () => {
    await redis.del(`otp:rl:${phone}`);
    await clearOtpIpRateLimit(redis);
    const { loginAs } = await import('./utils/auth-helper');
    const cookie = await loginAs(app, phone);
    const res = await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ name: 'Sara', gender: 'female' })
      .expect(200);
    expect(res.body.name).toBe('Sara');
    expect(res.body.gender).toBe('female');
  });

  it('rejects /me without a cookie', () =>
    request(app.getHttpServer()).get('/api/auth/me').expect(401));

  it('logout clears the cookie', async () => {
    await redis.del(`otp:rl:${phone}`);
    await clearOtpIpRateLimit(redis);
    const { loginAs } = await import('./utils/auth-helper');
    const cookie = await loginAs(app, phone);
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    const cleared = res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='));
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
  });
});
