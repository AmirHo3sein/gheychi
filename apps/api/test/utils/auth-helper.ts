import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { Repository } from 'typeorm';
import { REDIS } from '../../src/redis/redis.module';
import { User } from '../../src/users/user.entity';

/** Full OTP login; returns the session cookie string for use with .set('Cookie', ...) */
export async function loginAs(app: INestApplication, phone: string): Promise<string> {
  const redis = app.get<Redis>(REDIS);
  await redis.del(`otp:rl:${phone}`);
  await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
  const code = await redis.get(`otp:${phone}`);
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-otp')
    .send({ phone, code })
    .expect(201);
  return res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='))!;
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
