import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Feature flags: enforcement (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let slug: string;
  let serviceId: string;
  let bookingId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ownerCookie = await loginAs(app, '09166700001');
    customerCookie = await loginAs(app, '09166700002');
    adminCookie = await loginAsAdmin(app, '09166700003');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);

    const salonRes = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Feature Flags Test Salon',
        genderTarget: 'women',
        address: 'Somewhere St, No. 22',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        categoryIds: [categoriesRes.body[0].id],
      });
    salonId = salonRes.body.id;
    slug = salonRes.body.slug;

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Test Haircut', price: 500000, durationMin: 30 })
      .expect(201);
    serviceId = serviceRes.body.id;

    // A manually-inserted 'confirmed' + past-tense booking would need direct DB access;
    // instead reuse the offline/manual booking endpoint (source: 'manual') which inserts
    // straight to 'confirmed' with no payment involved, then flip it to 'completed' via the
    // salon-side status endpoint -- both are real, already-tested endpoints, not a DB hack.
    const bookingRes = await request(app.getHttpServer())
      .post('/api/salons/mine/bookings')
      .set('Cookie', ownerCookie)
      .send({ phone: '09166700002', serviceId, startsAt: new Date(Date.now() + 3600_000).toISOString() })
      .expect(201);
    bookingId = bookingRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setFlag(field: string, value: boolean) {
    await request(app.getHttpServer())
      .patch('/api/admin/feature-flags')
      .set('Cookie', adminCookie)
      .send({ [field]: value })
      .expect(200);
  }

  describe('reviews', () => {
    afterEach(() => setFlag('reviewsEnabled', true));

    it('blocks POST /reviews with 400 while disabled', async () => {
      await setFlag('reviewsEnabled', false);

      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5 })
        .expect(400);
    });

    it('returns an empty public review list while disabled, even though a review exists', async () => {
      await request(app.getHttpServer())
        .post('/api/reviews')
        .set('Cookie', customerCookie)
        .send({ bookingId, rating: 5, comment: 'عالی بود' })
        .expect(201);

      const enabledRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
      expect(enabledRes.body.total).toBe(1);

      await setFlag('reviewsEnabled', false);
      const disabledRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
      expect(disabledRes.body).toEqual({ items: [], total: 0, page: 1, pageSize: 50 });

      await setFlag('reviewsEnabled', true);
      const reenabledRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
      expect(reenabledRes.body.total).toBe(1);
    });

    it('zeroes the salon profile rating while disabled', async () => {
      await setFlag('reviewsEnabled', false);

      const res = await request(app.getHttpServer()).get(`/api/salons/${slug}`).expect(200);
      expect(res.body.ratingAvg).toBe('0');
      expect(res.body.ratingCount).toBe(0);
    });
  });

  describe('stories and portfolio', () => {
    let storyId: string;
    let portfolioItemId: string;

    beforeAll(async () => {
      const storyRes = await request(app.getHttpServer())
        .post('/api/salons/mine/stories')
        .set('Cookie', ownerCookie)
        .attach('file', MINIMAL_PNG, { filename: 'story.jpg', contentType: 'image/jpeg' })
        .expect(201);
      storyId = storyRes.body.id;

      const portfolioRes = await request(app.getHttpServer())
        .post('/api/salons/mine/portfolio')
        .set('Cookie', ownerCookie)
        .attach('file', MINIMAL_PNG, { filename: 'work.jpg', contentType: 'image/jpeg' })
        .expect(201);
      portfolioItemId = portfolioRes.body.id;
    });

    afterEach(async () => {
      await setFlag('storiesEnabled', true);
      await setFlag('portfolioEnabled', true);
    });

    it('hides stories from the public list while disabled, without blocking provider management', async () => {
      await setFlag('storiesEnabled', false);

      const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
      expect(publicRes.body).toEqual([]);

      const providerRes = await request(app.getHttpServer())
        .get('/api/salons/mine/stories')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(providerRes.body.some((s: { id: string }) => s.id === storyId)).toBe(true);
    });

    it('hides portfolio from the public list while disabled, without blocking provider management', async () => {
      await setFlag('portfolioEnabled', false);

      const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/portfolio`).expect(200);
      expect(publicRes.body).toEqual([]);

      const providerRes = await request(app.getHttpServer())
        .get('/api/salons/mine/portfolio')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(providerRes.body.some((p: { id: string }) => p.id === portfolioItemId)).toBe(true);
    });
  });

  describe('coupons', () => {
    afterEach(() => setFlag('couponsEnabled', true));

    it('blocks POST /coupons/validate with a distinct error code while disabled', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'FLAGTEST10', discountPercent: 10 })
        .expect(201);

      const enabledRes = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', customerCookie)
        .send({ code: 'FLAGTEST10', salonId, serviceId })
        .expect(201);
      expect(enabledRes.body.valid).toBe(true);

      await setFlag('couponsEnabled', false);
      const disabledRes = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', customerCookie)
        .send({ code: 'FLAGTEST10', salonId, serviceId })
        .expect(400);
      expect(disabledRes.body.code).toBe('COUPON_FEATURE_DISABLED');
    });
  });
});
