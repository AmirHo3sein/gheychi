import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { User } from '../src/users/user.entity';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Suspended users are blocked at login and mid-session (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    users = app.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks verify-otp for an already-suspended user', async () => {
    const phone = '09122290001';
    await loginAs(app, phone); // creates the user
    await users.update({ phone }, { status: 'suspended' });

    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    // loginAs's own verify-otp call would normally succeed; here we expect it to fail,
    // so call the raw endpoints instead of reusing the loginAs() helper.
    const Redis = (await import('ioredis')).default;
    const redis = app.get<InstanceType<typeof Redis>>((await import('../src/redis/redis.module')).REDIS);
    const code = await redis.get(`otp:${phone}`);
    await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code })
      .expect(403);
  });

  it('immediately locks out a user suspended mid-session, despite a still-valid cookie', async () => {
    const phone = '09122290002';
    const cookie = await loginAs(app, phone);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);

    await users.update({ phone }, { status: 'suspended' });

    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(403);
  });
});
