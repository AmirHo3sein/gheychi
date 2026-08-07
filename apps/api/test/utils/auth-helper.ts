import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { Repository } from 'typeorm';
import { REDIS } from '../../src/redis/redis.module';
import { User } from '../../src/users/user.entity';

/**
 * OtpService.issue() now also rate-limits per CALLER IP (see otp.service.ts), not just per
 * phone. Every e2e request in this whole suite originates from the same loopback address,
 * and unlike the per-phone key, Redis is never flushed between test FILES (only Postgres is
 * reset) -- without clearing this too, the shared IP counter would accumulate across every
 * login helper call in the entire e2e run and start rejecting real logins well before the
 * suite finishes. The exact loopback address string Node/Express assigns can vary
 * (127.0.0.1 / ::1 / ::ffff:127.0.0.1), so this clears by pattern rather than guessing one.
 */
export async function clearOtpIpRateLimit(redis: Redis): Promise<void> {
  const keys = await redis.keys('otp:rl:ip:*');
  if (keys.length > 0) await redis.del(...keys);
}

/**
 * Full OTP login; returns the session cookie string for use with .set('Cookie', ...).
 * `extra` is merged into the verify-otp body (e.g. `{ referralCode: 'ABC12345' }`) --
 * every existing call site keeps working unchanged since it's optional.
 */
export async function loginAs(app: INestApplication, phone: string, extra: Record<string, unknown> = {}): Promise<string> {
  const redis = app.get<Redis>(REDIS);
  await redis.del(`otp:rl:${phone}`);
  await clearOtpIpRateLimit(redis);
  await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
  const code = await redis.get(`otp:${phone}`);
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-otp')
    .send({ phone, code, ...extra })
    .expect(201);
  return res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='))!;
}

/** Same as loginAs, but returns the full verify-otp response body instead of just the cookie. */
export async function verifyOtpAndLogin(
  app: INestApplication,
  phone: string,
  extra: Record<string, unknown> = {},
): Promise<{ cookie: string; body: Record<string, unknown> }> {
  const redis = app.get<Redis>(REDIS);
  await redis.del(`otp:rl:${phone}`);
  await clearOtpIpRateLimit(redis);
  await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
  const code = await redis.get(`otp:${phone}`);
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-otp')
    .send({ phone, code, ...extra })
    .expect(201);
  const cookie = res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='))!;
  return { cookie, body: res.body };
}

/**
 * Logs in as `phone` (creating the user via the real OTP flow, same as loginAs), then
 * promotes that user directly to role='admin' via the repository. There's no self-service
 * admin signup in this codebase (by design -- the first admin is always a manual DB step),
 * so tests that need an admin session go through this instead of a real endpoint.
 */
export async function loginAsAdmin(app: INestApplication, phone: string): Promise<string> {
  const cookie = await loginAs(app, phone);
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  await users.update({ phone }, { role: 'admin' });
  return cookie;
}
