import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin reviews list (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122270001');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;

    const ownerCookie = await loginAs(app, '09122270002');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reviewed Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 11',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = salonRes.body.id;
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    // A salon_services row is required for the booking insert below (bookings.service_id is
    // NOT NULL, FK'd to salon_services). Created through the real endpoint -- like every other
    // e2e spec in this codebase does -- rather than seeded via raw SQL, since a service is
    // trivial to create through the API and there's no reason to bypass it here.
    await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 })
      .expect(201);

    // Directly seed two reviews via the repository -- creating them through the real
    // create-a-review flow would require a full completed booking per review, which is
    // unrelated to what this endpoint needs to prove (it only reads). This mirrors how
    // other e2e specs in this codebase seed fixture rows directly when the thing under
    // test is downstream of, not the creation flow itself.
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `INSERT INTO users (id, phone, role) VALUES ('00000000-0000-0000-0000-0000000000a1', '09122270099', 'customer')`,
    );
    await dataSource.query(
      `INSERT INTO bookings (id, salon_id, service_id, user_id, starts_at, ends_at, status, price_snapshot, deposit_amount)
       SELECT '00000000-0000-0000-0000-0000000000b1', $1, id, '00000000-0000-0000-0000-0000000000a1', now(), now(), 'completed', 100000, 20000
       FROM salon_services WHERE salon_id = $1 LIMIT 1`,
      [salonId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists reviews filtered by salonId', async () => {
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `INSERT INTO reviews (id, booking_id, salon_id, user_id, rating, comment, status)
       VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', $1, '00000000-0000-0000-0000-0000000000a1', 4, 'خوب بود', 'published')`,
      [salonId],
    );

    const res = await request(app.getHttpServer())
      .get(`/api/admin/reviews?salonId=${salonId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].comment).toBe('خوب بود');
  });

  it('filters by status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/reviews?status=rejected')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('filters by rating', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/reviews?rating=4')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122270098');
    await request(app.getHttpServer()).get('/api/admin/reviews').set('Cookie', customerCookie).expect(403);
  });

  it('paginates results and reports the true total across all pages', async () => {
    const dataSource = app.get(DataSource);
    // A second completed booking + review on the same salon, so there are two reviews
    // total to page across (the first review was seeded by the 'lists reviews filtered
    // by salonId' test above, in the same salon/booking fixture chain).
    await dataSource.query(
      `INSERT INTO bookings (id, salon_id, service_id, user_id, starts_at, ends_at, status, price_snapshot, deposit_amount)
       SELECT '00000000-0000-0000-0000-0000000000b2', $1, id, '00000000-0000-0000-0000-0000000000a1', now(), now(), 'completed', 100000, 20000
       FROM salon_services WHERE salon_id = $1 LIMIT 1`,
      [salonId],
    );
    await dataSource.query(
      `INSERT INTO reviews (id, booking_id, salon_id, user_id, rating, comment, status)
       VALUES ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', $1, '00000000-0000-0000-0000-0000000000a1', 5, 'دوباره اومدم', 'published')`,
      [salonId],
    );

    const page1 = await request(app.getHttpServer())
      .get(`/api/admin/reviews?salonId=${salonId}&page=1&pageSize=1`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.total).toBe(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(1);

    const page2 = await request(app.getHttpServer())
      .get(`/api/admin/reviews?salonId=${salonId}&page=2&pageSize=1`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(2);
    // Confirms skip/take is genuinely wired to `page`, not just accepted and ignored.
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
  });
});
