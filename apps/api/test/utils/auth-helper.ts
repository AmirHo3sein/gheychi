import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../../src/redis/redis.module';

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
