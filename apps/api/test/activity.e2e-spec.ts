import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Activity feed (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ownerCookie = await loginAs(app, '09166800001');
    customerCookie = await loginAs(app, '09166800002');
    adminCookie = await loginAsAdmin(app, '09166800003');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);

    const salonRes = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Activity Feed Test Salon',
        genderTarget: 'women',
        address: 'Somewhere St, No. 33',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        categoryIds: [categoriesRes.body[0].id],
      });
    salonId = salonRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Activity Test Haircut', price: 400000, durationMin: 30 })
      .expect(201);
    serviceId = serviceRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty page with hasMore:false for a customer with no activity', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .set('Cookie', customerCookie)
      .expect(200);

    expect(res.body).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app.getHttpServer()).get('/api/activity/mine').expect(401);
  });

  it('includes a manual booking and a completed-booking review, enriched with real names', async () => {
    const bookingRes = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone: '09166800002', serviceId, startsAt: new Date(Date.now() + 3600_000).toISOString() })
      .expect(201);
    const bookingId = bookingRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 4, comment: 'خوب بود' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .set('Cookie', customerCookie)
      .expect(200);

    expect(res.body.items).toHaveLength(2);
    // Review comes after the booking in real time (submitted afterward), so it's first
    // in the newest-first feed.
    const [reviewItem, bookingItem] = res.body.items;
    expect(reviewItem).toMatchObject({
      type: 'review',
      detail: { rating: 4, comment: 'خوب بود', salonName: 'Activity Feed Test Salon' },
    });
    expect(bookingItem).toMatchObject({
      type: 'booking',
      id: bookingId,
      detail: {
        status: 'completed',
        source: 'manual',
        salonName: 'Activity Feed Test Salon',
        serviceName: 'Activity Test Haircut',
      },
    });
  });

  it('never leaks another user\'s activity', async () => {
    const otherCustomerCookie = await loginAs(app, '09166800004');

    const res = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .set('Cookie', otherCustomerCookie)
      .expect(200);

    expect(res.body.items).toEqual([]);
  });

  it('paginates via cursor -- a small limit plus the returned nextCursor walks the whole feed with no gaps or dupes', async () => {
    const full = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(full.body.items.length).toBeGreaterThanOrEqual(2);

    const page1 = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .query({ limit: 1 })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get('/api/activity/mine')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    const walked = [...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id);
    const direct = full.body.items.slice(0, 2).map((i: { id: string }) => i.id);
    expect(walked).toEqual(direct);
  });
});
