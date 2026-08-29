import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { BookingExpiryJob } from '../src/booking/booking-expiry.job';

describe('Booking expiry job (e2e)', () => {
  let app: INestApplication;
  let job: BookingExpiryJob;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    job = app.get(BookingExpiryJob);

    const ownerCookie = await loginAs(app, '09127070012');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Expiry Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
      categoryIds: [categoryId],
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09128080013');
  });

  afterAll(async () => {
    await app.close();
  });

  it('expires a pending_payment booking older than the hold TTL, and leaves a fresh one untouched', async () => {
    const stale = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const fresh = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    // Ageing a hold now means shifting its own snapshotted deadline too, not just
    // created_at: a booking created today carries payment_expires_at, and THAT is what
    // the job reads (created_at is only the fallback for rows predating that column).
    // Shifting both by the same interval is the honest simulation of "this hold is
    // 20 minutes old".
    await ds.query(
      `UPDATE bookings
          SET created_at = now() - interval '20 minutes',
              payment_expires_at = payment_expires_at - interval '20 minutes'
        WHERE id = $1`,
      [stale.body.booking.id],
    );

    const affected = await job.run();
    expect(affected).toBe(1);

    const staleAfter = await request(app.getHttpServer())
      .get(`/api/bookings/${stale.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(staleAfter.body.status).toBe('expired');

    const freshAfter = await request(app.getHttpServer())
      .get(`/api/bookings/${fresh.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(freshAfter.body.status).toBe('pending_payment');
  });

  it('hands the coupon code back when the hold it was spent on expires', async () => {
    // The redemption row is inserted inside createHold's transaction (that's what makes
    // the per-user cap race-safe), so an abandoned hold used to burn the code for life
    // via UNIQUE(coupon_id, user_id) -- with no admin reissue path for a referral reward.
    const ownerCookie = await loginAs(app, '09127070012');
    await request(app.getHttpServer())
      .post('/api/salons/mine/coupons')
      .set('Cookie', ownerCookie)
      .send({ code: 'EXPIRY25', discountPercent: 25 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString(), couponCode: 'EXPIRY25' })
      .expect(201);
    expect(created.body.couponApplied).toBe(true);

    const ds = app.get(DataSource);
    const before = await ds.query(`SELECT id FROM coupon_redemptions WHERE booking_id = $1`, [created.body.booking.id]);
    expect(before).toHaveLength(1);

    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes', payment_expires_at = payment_expires_at - interval '20 minutes' WHERE id = $1`, [
      created.body.booking.id,
    ]);
    await job.run();

    const after = await ds.query(`SELECT id FROM coupon_redemptions WHERE booking_id = $1`, [created.body.booking.id]);
    expect(after).toHaveLength(0);

    // Proof it's genuinely usable again, not just absent from the audit table.
    await request(app.getHttpServer())
      .post('/api/coupons/validate')
      .set('Cookie', customerCookie)
      .send({ code: 'EXPIRY25', salonId, serviceId })
      .expect(201);
  });

  it('releases the slot once expired, letting a new booking take it', async () => {
    const startsAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    const first = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes', payment_expires_at = payment_expires_at - interval '20 minutes' WHERE id = $1`, [first.body.booking.id]);
    await job.run();

    const secondCustomer = await loginAs(app, '09129090014');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(201);
  });
});
