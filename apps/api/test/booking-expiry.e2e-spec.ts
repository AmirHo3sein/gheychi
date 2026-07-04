import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
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
    app = await createTestApp();
    job = app.get(BookingExpiryJob);

    const ownerCookie = await loginAs(app, '09127070012');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Expiry Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
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
    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes' WHERE id = $1`, [stale.body.booking.id]);

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

  it('releases the slot once expired, letting a new booking take it', async () => {
    const startsAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    const first = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(`UPDATE bookings SET created_at = now() - interval '20 minutes' WHERE id = $1`, [first.body.booking.id]);
    await job.run();

    const secondCustomer = await loginAs(app, '09129090014');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(201);
  });
});
