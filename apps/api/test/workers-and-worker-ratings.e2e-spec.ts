import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Workers + worker ratings (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let salonSlug: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09151110001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Worker Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;
    salonSlug = salonRes.body.slug;

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

    customerCookie = await loginAs(app, '09152220002');
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

  describe('worker roster CRUD', () => {
    it('rejects a salon owner adding themselves as a worker', async () => {
      const meRes = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', ownerCookie).expect(200);
      await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .send({ name: 'Self', phone: meRes.body.phone })
        .expect(400);
    });

    it('creates a worker on the roster', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .send({ name: 'Sara Stylist', phone: '09153330003' })
        .expect(201);
      expect(res.body.name).toBe('Sara Stylist');
      expect(res.body.active).toBe(true);
      expect(Number(res.body.ratingAvg)).toBe(0);
      expect(res.body.ratingCount).toBe(0);
    });

    it('lists all workers (active and inactive), newest first', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Sara Stylist');
    });

    it('409s adding the same phone twice to the same salon', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .send({ name: 'Sara Again', phone: '09153330003' })
        .expect(409);
    });

    it('rejects unauthenticated worker creation', () =>
      request(app.getHttpServer()).post('/api/salons/mine/workers').send({ name: 'X', phone: '09150000000' }).expect(401));

    it('isolates workers across salons -- a stranger owner cannot see or patch them', async () => {
      const otherOwnerCookie = await loginAs(app, '09154440004');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
        name: 'Other Owner Salon',
        genderTarget: 'women',
        address: 'Elsewhere St, No. 2',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        capacity: 5,
      });

      const listRes = await request(app.getHttpServer())
        .get('/api/salons/mine/workers')
        .set('Cookie', otherOwnerCookie)
        .expect(200);
      expect(listRes.body).toHaveLength(0);

      const mine = await request(app.getHttpServer()).get('/api/salons/mine/workers').set('Cookie', ownerCookie).expect(200);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${mine.body[0].id}`)
        .set('Cookie', otherOwnerCookie)
        .send({ active: false })
        .expect(404);
    });
  });

  describe('assign worker + worker rating end-to-end', () => {
    let workerId: string;
    let bookingId: string;
    let reviewId: string;

    it('the owner assigns the active worker to a completed booking', async () => {
      const workersRes = await request(app.getHttpServer())
        .get('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .expect(200);
      workerId = workersRes.body[0].id;

      bookingId = await bookPayAndComplete(24);

      const res = await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}/assign-worker`)
        .set('Cookie', ownerCookie)
        .send({ workerId })
        .expect(200);
      expect(res.body.workerId).toBe(workerId);
      expect(res.body.workerName).toBe('Sara Stylist');
    });

    it('404s assigning a worker that does not belong to the caller salon', async () => {
      const otherOwnerCookie = await loginAs(app, '09155550005');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
        name: 'Yet Another Salon',
        genderTarget: 'women',
        address: 'Nowhere St, No. 3',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        capacity: 5,
      });

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}/assign-worker`)
        .set('Cookie', otherOwnerCookie)
        .send({ workerId })
        .expect(404);
    });

    it('400s a review that omits workerRating for a booking with an assigned worker', async () => {
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5 })
        .expect(400);
    });

    it('submits a review with a worker rating, publishing both atomically', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5, comment: 'Great cut!', workerRating: 4 })
        .expect(201);
      reviewId = res.body.id;
      expect(res.body.rating).toBe(5);
    });

    it('reflects the worker rating aggregate on the public salon worker list', async () => {
      const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers`).expect(200);
      const worker = res.body.find((w: { id: string }) => w.id === workerId);
      expect(worker).toBeDefined();
      expect(worker.ratingAvg).toBe(4);
      expect(worker.ratingCount).toBe(1);
    });

    it('exposes the published rating on the public per-worker ratings endpoint', async () => {
      const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers/${workerId}/ratings`).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].rating).toBe(4);
    });

    it('lets the reviewer edit the worker rating within the edit window, recomputing the aggregate again', async () => {
      await request(app.getHttpServer())
        .patch(`/api/reviews/${reviewId}`)
        .set('Cookie', customerCookie)
        .send({ workerRating: 2 })
        .expect(200);

      const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers`).expect(200);
      const worker = res.body.find((w: { id: string }) => w.id === workerId);
      expect(worker.ratingAvg).toBe(2);
      expect(worker.ratingCount).toBe(1);
    });

    it('rejects a workerRating edit from someone other than the reviewer', async () => {
      const stranger = await loginAs(app, '09156660006');
      await request(app.getHttpServer())
        .patch(`/api/reviews/${reviewId}`)
        .set('Cookie', stranger)
        .send({ workerRating: 1 })
        .expect(403);
    });

    it('withdraws the review on DELETE, excluding it from both aggregates', async () => {
      await request(app.getHttpServer()).delete(`/api/reviews/${reviewId}`).set('Cookie', customerCookie).expect(204);

      const salonReviewsRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
      expect(salonReviewsRes.body).toHaveLength(0);

      const workersRes = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers`).expect(200);
      const worker = workersRes.body.find((w: { id: string }) => w.id === workerId);
      expect(worker.ratingCount).toBe(0);

      const ratingsRes = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers/${workerId}/ratings`).expect(200);
      expect(ratingsRes.body.total).toBe(0);
    });

    it('permanently blocks a second review for the same booking, even after withdrawal', async () => {
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 3, workerRating: 3 })
        .expect(409);
    });
  });

  describe('a booking with no assigned worker', () => {
    it('rejects a workerRating on a review for a booking with no worker', async () => {
      const bookingId = await bookPayAndComplete(72);
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5, workerRating: 5 })
        .expect(400);
    });

    it('accepts a plain review (no workerRating) for a booking with no worker', async () => {
      const bookingId = await bookPayAndComplete(96);
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5 })
        .expect(201);
    });
  });

  describe('admin worker-rating moderation', () => {
    // Shared across this describe block's tests so the later listing assertions can
    // pin down exactly which rows they mean, instead of an ambiguous `LIMIT 1` that
    // could also match the withdrawn-review cascade's rejected worker_ratings row
    // from the earlier describe block.
    let rejectedWorkerRatingId: string;
    let rejectedReviewId: string;

    it('rejects a worker rating and recomputes the aggregate to exclude it', async () => {
      const workersListRes = await request(app.getHttpServer())
        .get('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .expect(200);
      const workerId = workersListRes.body[0].id;

      const bookingId = await bookPayAndComplete(120);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}/assign-worker`)
        .set('Cookie', ownerCookie)
        .send({ workerId })
        .expect(200);
      const reviewRes = await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5, workerRating: 5 })
        .expect(201);
      rejectedReviewId = reviewRes.body.id;

      const ds = app.get(DataSource);
      const [wr] = await ds.query('SELECT id FROM worker_ratings WHERE review_id = $1', [reviewRes.body.id]);
      rejectedWorkerRatingId = wr.id;

      const adminCookie = await loginAs(app, '09157770007');
      await ds.query(`UPDATE users SET role = 'admin' WHERE phone = '09157770007'`);

      await request(app.getHttpServer())
        .patch(`/api/admin/worker-ratings/${wr.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'rejected' })
        .expect(200);

      const [worker] = await ds.query('SELECT rating_avg, rating_count FROM workers WHERE id = $1', [workerId]);
      expect(worker.rating_count).toBe(0);
    });

    it('lists worker ratings for admin with workerName/salonName joined, filterable by status', async () => {
      const adminCookie = await loginAs(app, '09157770007'); // already promoted to admin above
      const res = await request(app.getHttpServer())
        .get('/api/admin/worker-ratings?status=rejected')
        .set('Cookie', adminCookie)
        .expect(200);
      const row = res.body.items.find((r: { id: string }) => r.id === rejectedWorkerRatingId);
      expect(row).toBeDefined();
      expect(row.workerName).toBe('Sara Stylist');
      expect(row.salonName).toBe('Worker Test Salon');
    });

    it('rejects a non-admin caller listing worker ratings', async () => {
      await request(app.getHttpServer()).get('/api/admin/worker-ratings').set('Cookie', customerCookie).expect(403);
    });

    it("surfaces the linked worker rating on the review's admin listing", async () => {
      const adminCookie = await loginAs(app, '09157770007');

      const res = await request(app.getHttpServer())
        .get(`/api/admin/reviews?salonId=${salonId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      const review = res.body.items.find((r: { id: string }) => r.id === rejectedReviewId);
      expect(review.workerRating).toEqual({ score: 5, workerName: 'Sara Stylist' });
    });

    it('rejects worker-rating moderation from a non-admin', async () => {
      const ds = app.get(DataSource);
      const [wr] = await ds.query('SELECT id FROM worker_ratings LIMIT 1');
      await request(app.getHttpServer())
        .patch(`/api/admin/worker-ratings/${wr.id}/status`)
        .set('Cookie', customerCookie)
        .send({ status: 'published' })
        .expect(403);
    });
  });
});
