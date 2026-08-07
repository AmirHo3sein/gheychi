import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon-side booking management (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let confirmedBookingId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09122020007');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Provider Bookings Salon',
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

    customerCookie = await loginAs(app, '09123030008');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    confirmedBookingId = created.body.booking.id;
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the salon\'s bookings for the owner', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(confirmedBookingId);
  });

  it('rejects a non-owner from listing the salon\'s bookings', () =>
    request(app.getHttpServer())
      .get('/api/salons/mine/bookings')
      .set('Cookie', customerCookie)
      .expect(404)); // customer has no salon of their own -- SalonOwnerGuard 404s via findMine

  it('marks a confirmed booking completed', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    expect(res.body.status).toBe('completed');
  });

  it('rejects marking an already-completed booking again', () =>
    request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${confirmedBookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'no_show' })
      .expect(400));

  it('rejects an invalid status value', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'bogus' })
      .expect(400);
  });
});
