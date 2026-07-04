import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Payments — callback (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09129990005');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Payments Test Salon',
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

    customerCookie = await loginAs(app, '09121010006');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  function extractAuthority(paymentUrl: string): string {
    return new URL(paymentUrl).searchParams.get('Authority')!;
  }

  it('confirms the booking and marks the payment paid on a successful callback', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
    expect(res.body.status).toBe('success');

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');
  });

  it('is idempotent — calling the callback again on an already-paid booking returns already-confirmed, not an error', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(48) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    const second = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(200);
    expect(second.body.status).toBe('already-confirmed');
  });

  it('cancels the booking when Zarinpal reports Status=NOK', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'NOK' })
      .expect(200);
    expect(res.body.status).toBe('failed');

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('cancelled_by_user');
  });

  it('404s for an authority that does not exist', () =>
    request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: 'MOCK-doesnotexist', Status: 'OK' })
      .expect(404));
});
