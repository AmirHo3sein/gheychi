import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Bookings — create hold (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09125550001');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Booking Test Salon',
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
      .send({ categoryId: 1, name: 'Cut', price: 2000000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09126660002');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  it('creates a pending_payment booking with a 20% deposit and a mock payment URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);

    expect(res.body.booking.status).toBe('pending_payment');
    expect(res.body.booking.priceSnapshot).toBe(2000000);
    // deposit_min_toman is seeded at 200000, so the price here (2000000) must be high
    // enough that 20% of it (400000) genuinely exceeds the floor -- otherwise this
    // test would silently only ever exercise the minimum-floor path, not the
    // percentage path its own name claims to test.
    expect(res.body.booking.depositAmount).toBe(400000); // 20% of 2000000
    expect(res.body.paymentUrl).toContain('Authority=MOCK-');
  });

  it('rejects a startsAt in the past', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(-1) })
      .expect(400));

  it('rejects a second overlapping booking once capacity (1) is full', async () => {
    const startsAt = futureIso(48);
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const secondCustomer = await loginAs(app, '09127770003');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(409);
  });

  it('lists the caller\'s own bookings via GET /bookings/mine', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bookings/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('fetches a single booking by id, scoped to the caller', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const bookingId = created.body.booking.id;

    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);

    const otherCustomer = await loginAs(app, '09128880004');
    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', otherCustomer)
      .expect(404);
  });

  it('requires auth to create a booking', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(401));

  describe('POST /bookings/:id/retry-payment', () => {
    it('returns a fresh paymentUrl for a pending_payment booking owned by the caller', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(96) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const res = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(res.body.paymentUrl).toContain('Authority=MOCK-');
    });

    it('returns 404 when the booking belongs to a different user', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(120) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const otherCustomer = await loginAs(app, '09129990005');
      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', otherCustomer)
        .expect(404);
    });

    it('returns 409 when the booking is already confirmed', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(144) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const ds = app.get(DataSource);
      await ds.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(409);
    });

    it('returns 404 for a nonexistent booking id', () =>
      request(app.getHttpServer())
        .post('/api/bookings/00000000-0000-0000-0000-000000000000/retry-payment')
        .set('Cookie', customerCookie)
        .expect(404));
  });
});
