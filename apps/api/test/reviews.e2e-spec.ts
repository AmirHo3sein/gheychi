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
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
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
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
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
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
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

describe('Reviews — public listing (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09134440004');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Listing Test Salon',
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
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09135550005');
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
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('returns an empty array for a salon with no reviews', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body).toEqual([]);
  });

  it('lists published reviews without requiring auth', async () => {
    const bookingId = await bookPayAndComplete(24);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 4, comment: 'Good' })
      .expect(201);

    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].rating).toBe(4);
    expect(res.body[0].comment).toBe('Good');

    // The listing is unauthenticated, so the payload must never carry reviewer
    // identity or the booking it came from -- asserted on the wire (not just at the
    // service boundary) since that's what an anonymous scraper actually sees.
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['comment', 'createdAt', 'id', 'rating', 'salonReply', 'salonReplyAt'],
    );
  });
});

describe('Reviews — salon owner reply (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let reviewId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09136660006');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reply Test Salon',
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
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09137770007');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 5 })
      .expect(201);
    reviewId = reviewRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the salon owner reply to a review', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: 'Thank you for visiting!' })
      .expect(200);
    expect(res.body.salonReply).toBe('Thank you for visiting!');
    expect(res.body.salonReplyAt).not.toBeNull();
  });

  it('lets the owner update an existing reply', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: 'Updated reply' })
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body[0].salonReply).toBe('Updated reply');
  });

  it('rejects a reply from someone who does not own a salon', async () => {
    const stranger = await loginAs(app, '09138880008');
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', stranger)
      .send({ reply: 'Not mine to reply to' })
      .expect(404);
  });

  it('rejects a reply to a review belonging to a different salon', async () => {
    // Distinct from the "no salon at all" case above -- this exercises the
    // service method's own salonId filter (findOneBy({ id, salonId })), the
    // actual authorization boundary this task exists to enforce, not just
    // SalonOwnerGuard's separate "caller has zero salons" 404 path.
    const otherOwnerCookie = await loginAs(app, '09149990010');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
      name: 'Other Owner Salon',
      genderTarget: 'women',
      address: 'Elsewhere St, No. 2',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', otherOwnerCookie)
      .send({ reply: 'Trying to reply to a review that is not mine' })
      .expect(404);
  });

  it('rejects an empty reply', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: '' })
      .expect(400);
  });
});

describe('Reviews — admin moderation (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;
  let reviewId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09139990009');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Moderation Test Salon',
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
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09121010010');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 5 })
      .expect(201);
    reviewId = reviewRes.body.id;

    adminCookie = await loginAs(app, '09122020011');
    const [admin] = await ds.query(`SELECT id FROM users WHERE phone = '09122020011'`);
    await ds.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects moderation from a non-admin', () =>
    request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', customerCookie)
      .send({ status: 'rejected' })
      .expect(403));

  it('lets an admin reject a review, excluding it from the salon rating', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(200);
    expect(res.body.status).toBe('rejected');

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(salon.rating_count).toBe(0);

    const listRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(listRes.body).toEqual([]);
  });

  it('lets an admin reverse a rejection back to published', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(salon.rating_count).toBe(1);
    expect(Number(salon.rating_avg)).toBe(5);
  });

  it('404s for a nonexistent review', () =>
    request(app.getHttpServer())
      .patch('/api/admin/reviews/00000000-0000-4000-8000-000000000099')
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(404));

  it('preserves an existing salon reply through a reject-then-republish cycle', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: 'Thanks for the feedback!' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body[0].salonReply).toBe('Thanks for the feedback!');
  });
});
