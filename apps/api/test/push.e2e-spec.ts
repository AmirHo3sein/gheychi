import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Push subscriptions (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09150000001');
  });

  afterAll(async () => {
    await app.close();
  });

  it('subscribes a device', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1', p256dh: 'key1', auth: 'auth1' })
      .expect(201);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(1);
  });

  it('is idempotent for the same endpoint (updates keys rather than duplicating)', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1', p256dh: 'key1-updated', auth: 'auth1' })
      .expect(201);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('key1-updated');
  });

  it('unsubscribes a device', async () => {
    await request(app.getHttpServer())
      .delete('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/device-1' })
      .expect(204);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT * FROM push_subscriptions WHERE endpoint = $1`, [
      'https://push.example.com/device-1',
    ]);
    await ds.destroy();
    expect(rows).toHaveLength(0);
  });

  it('rejects an unauthenticated subscribe attempt', async () => {
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://push.example.com/device-2', p256dh: 'k', auth: 'a' })
      .expect(401);
  });
});
