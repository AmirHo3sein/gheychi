import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { PUSH_PROVIDER, PushProvider } from '../src/push/push.provider';
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

  it("refuses to re-point another user's push endpoint at the caller (would hijack their device)", async () => {
    const victimCookie = await loginAs(app, '09150000010');
    const attackerCookie = await loginAs(app, '09150000011');
    const endpoint = 'https://push.example.com/victim-device';

    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', victimCookie)
      .send({ endpoint, p256dh: 'k', auth: 'a' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', attackerCookie)
      .send({ endpoint, p256dh: 'attacker-key', auth: 'attacker-auth' })
      .expect(403);

    const ds = testDataSource();
    await ds.initialize();
    const [row] = await ds.query(
      `SELECT user_id, p256dh FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint],
    );
    const [victim] = await ds.query(`SELECT id FROM users WHERE phone = $1`, ['09150000010']);
    await ds.destroy();
    expect(row.user_id).toBe(victim.id);
    expect(row.p256dh).toBe('k');
  });

  it('still lets the SAME user re-subscribe the same device (key rotation is the legitimate case)', async () => {
    const cookie = await loginAs(app, '09150000012');
    const endpoint = 'https://push.example.com/my-device';

    await request(app.getHttpServer()).post('/api/push/subscribe').set('Cookie', cookie).send({ endpoint, p256dh: 'old', auth: 'a' }).expect(201);
    await request(app.getHttpServer()).post('/api/push/subscribe').set('Cookie', cookie).send({ endpoint, p256dh: 'new', auth: 'b' }).expect(201);

    const ds = testDataSource();
    await ds.initialize();
    const [row] = await ds.query(`SELECT p256dh FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    await ds.destroy();
    expect(row.p256dh).toBe('new');
  });

  it('records which app subscribed (customer by default, provider when the panel says so) and rejects anything else', async () => {
    const cookie = await loginAs(app, '09150000013');
    await request(app.getHttpServer()).post('/api/push/subscribe').set('Cookie', cookie).send({ endpoint: 'https://push.example.com/aud-c', p256dh: 'k', auth: 'a' }).expect(201);
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/aud-p', p256dh: 'k', auth: 'a', audience: 'provider' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/aud-x', p256dh: 'k', auth: 'a', audience: 'admin' })
      .expect(400);

    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(`SELECT endpoint, audience FROM push_subscriptions WHERE endpoint LIKE 'https://push.example.com/aud-%' ORDER BY endpoint`);
    await ds.destroy();
    expect(rows).toEqual([
      { endpoint: 'https://push.example.com/aud-c', audience: 'customer' },
      { endpoint: 'https://push.example.com/aud-p', audience: 'provider' },
    ]);
  });

  it("sends a salon owner's new-booking push to their provider-panel subscription only, with a salon-booking link", async () => {
    const ownerCookie = await loginAs(app, '09150000020');
    const customerCookie = await loginAs(app, '09150000021');
    const { salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { name: 'Push Salon' }, { name: 'Cut', price: 200_000, durationMin: 30 });
    for (const [endpoint, audience] of [['https://push.example.com/owner-panel', 'provider'], ['https://push.example.com/owner-phone', undefined]] as const) {
      await request(app.getHttpServer()).post('/api/push/subscribe').set('Cookie', ownerCookie).send({ endpoint, p256dh: 'k', auth: 'a', audience }).expect(201);
    }

    const provider = app.get<PushProvider>(PUSH_PROVIDER);
    const send = jest.spyOn(provider, 'send');
    try {
      await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: new Date(Date.now() + 30 * 3600_000).toISOString() })
        .expect(201);
      // Notifications are fire-and-forget after the response.
      await new Promise((r) => setTimeout(r, 300));

      const toOwner = send.mock.calls.filter(([target]) => target.endpoint.startsWith('https://push.example.com/owner-'));
      expect(toOwner.map(([target]) => target.endpoint)).toEqual(['https://push.example.com/owner-panel']);
      expect(toOwner[0]![1]).toEqual(expect.objectContaining({ data: { type: 'salon-booking', bookingId: expect.any(String) } }));
    } finally {
      send.mockRestore();
    }
  });
});
