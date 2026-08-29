import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { RefundRetryJob } from '../src/booking/refund-retry.job';
import { REDIS } from '../src/redis/redis.module';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Money-critical alerting (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();

    // Alert dedup keys live in Redis and survive resetDatabase() -- a re-run inside
    // the 6h window would silently suppress this test's alert. Clear ONLY alert keys
    // (never flushdb: OTP/lock state of concurrently-running e2e files shares this Redis).
    const redis = app.get<Redis>(REDIS);
    const dedupKeys = await redis.keys('alert:dedup:*');
    if (dedupKeys.length > 0) await redis.del(...dedupKeys);

    adminCookie = await loginAsAdmin(app, '09127770001');
    ownerCookie = await loginAs(app, '09127770002');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Alerts Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
      categoryIds: [categoriesRes.body[0].id],
    });
    salonId = salonRes.body.id;
    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09127770003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('a refused refund produces an unread admin notification of type alert', async () => {
    // Book + pay (mock gateway confirms instantly via the callback redirect).
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);

    // Force MockPaymentGateway.refundPayment to refuse, then cancel (refund-eligible).
    const ds = app.get(DataSource);
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE booking_id = $1`, [
      created.body.booking.id,
    ]);
    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customerCookie)
      .expect(200);

    // The refused refund must now be visible to the admin.
    const list = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    const alert = list.body.items.find(
      (n: { type: string; title: string }) => n.type === 'alert' && n.title === 'بازپرداخت پذیرفته نشد',
    );
    expect(alert).toBeDefined();

    const count = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count.body.count).toBeGreaterThanOrEqual(1);
  });

  it('the same condition does not alert twice inside the dedup window', async () => {
    // Deliberately continues the previous test's scenario (its refund_pending payment
    // and its first alert) -- the two its are one flow split for readability, so a
    // failure here can also mean the previous test broke upstream. The isolation
    // guarantee for the exact-count assertion below comes from e2e --runInBand plus
    // this file's own resetDatabase(), not from the dedup key.
    //
    // RefundRetryJob would re-detect the refused refund on its next tick; simulate by
    // re-running the inline attempt via a second cancel attempt being impossible, so
    // instead invoke the retry job directly after backdating the grace period.
    const ds = app.get(DataSource);
    await ds.query(`UPDATE payments SET refund_requested_at = now() - interval '10 minutes' WHERE status = 'refund_pending'`);

    const job = app.get(RefundRetryJob);
    await job.run();

    const list = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', adminCookie)
      .expect(200);
    const alerts = list.body.items.filter(
      (n: { type: string; title: string }) => n.type === 'alert' && n.title === 'بازپرداخت پذیرفته نشد',
    );
    expect(alerts).toHaveLength(1); // deduped: still just the original alert
  });
});
