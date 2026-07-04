import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Reviews — creation (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09131110001');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Review Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
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

    customerCookie = await loginAs(app, '09132220002');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookPayAndComplete(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('creates a review for a completed booking and recomputes the salon rating', async () => {
    const bookingId = await bookPayAndComplete(24);
    const res = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 5, comment: 'Great service!' })
      .expect(201);

    expect(res.body.status).toBe('published');
    expect(res.body.rating).toBe(5);
    expect(res.body.comment).toBe('Great service!');

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(Number(salon.rating_avg)).toBe(5);
    expect(salon.rating_count).toBe(1);
  });

  it('averages correctly across multiple published reviews', async () => {
    const bookingId = await bookPayAndComplete(48);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 3 })
      .expect(201);

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(Number(salon.rating_avg)).toBe(4); // (5 + 3) / 2
    expect(salon.rating_count).toBe(2);
  });

  it('rejects a review for a booking that is not completed', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 4 })
      .expect(400);
  });

  it('rejects a review for a booking that does not belong to the caller', async () => {
    const bookingId = await bookPayAndComplete(96);
    const stranger = await loginAs(app, '09133330003');
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', stranger)
      .send({ bookingId, rating: 4 })
      .expect(404);
  });

  it('rejects a second review for the same booking', async () => {
    const bookingId = await bookPayAndComplete(120);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 2 })
      .expect(409);
  });

  it('rejects an out-of-range rating', async () => {
    const bookingId = await bookPayAndComplete(144);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 6 })
      .expect(400);
  });

  it('requires auth to create a review', () =>
    request(app.getHttpServer()).post('/api/reviews').send({ bookingId: '00000000-0000-4000-8000-000000000099', rating: 5 }).expect(401));
});
