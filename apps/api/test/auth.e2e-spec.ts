import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/redis/redis.module';
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
    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    expect(await redis.get(`otp:${phone}`)).toMatch(/^\d{6}$/);
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
