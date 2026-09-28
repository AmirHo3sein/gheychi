import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon services (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let categoryId: number;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220000');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    categoryId = categoriesRes.body[0].id;
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let serviceId: string;

  it('creates a service', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId, name: 'Bob Haircut', price: 800000, durationMin: 45 })
      .expect(201);
    serviceId = res.body.id;
    expect(res.body.isActive).toBe(true);
  });

  it('lists active services', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/services')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].price).toBe(800000);
  });

  it('updates a service', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', cookie)
      .send({ price: 900000 })
      .expect(200);
    expect(res.body.price).toBe(900000);
  });

  it('rejects a description over the 1000-char cap, on both create and update', async () => {
    const tooLong = 'a'.repeat(1001);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', cookie)
      .send({ description: tooLong })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId, name: 'Over-long Description Service', price: 100000, durationMin: 30, description: tooLong })
      .expect(400);
  });

  it('archives on delete (disappears from list)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', cookie)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/services')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/services').expect(401));

  describe('pricing types', () => {
    it('creates a FROM service with just a floor price', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Hair Coloring', pricingType: 'from', price: 1000000, durationMin: 90 })
        .expect(201);
      expect(res.body.pricingType).toBe('from');
      expect(res.body.price).toBe(1000000);
      expect(res.body.priceMax).toBeNull();
    });

    it('creates a RANGE service with min and max', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Keratin', pricingType: 'range', price: 2000000, priceMax: 5000000, durationMin: 180 })
        .expect(201);
      expect(res.body.pricingType).toBe('range');
      expect(res.body.price).toBe(2000000);
      expect(res.body.priceMax).toBe(5000000);
    });

    it('rejects a RANGE service missing priceMax', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Broken Range', pricingType: 'range', price: 2000000, durationMin: 60 })
        .expect(400));

    it('rejects a RANGE service where priceMax < price', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Inverted Range', pricingType: 'range', price: 5000000, priceMax: 2000000, durationMin: 60 })
        .expect(400));

    it('creates a QUOTE service with no price at all', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Special Treatment', pricingType: 'quote', durationMin: 60 })
        .expect(201);
      expect(res.body.pricingType).toBe('quote');
      expect(res.body.price).toBeNull();
    });

    it('rejects a QUOTE service that also sends a price', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Contradictory Quote', pricingType: 'quote', price: 100000, durationMin: 60 })
        .expect(400));

    it('rejects a FIXED service (the default) with no price', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'No Price Fixed', durationMin: 60 })
        .expect(400));

    it('rejects a discount on a non-fixed service', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({
          categoryId, name: 'Discounted From', pricingType: 'from', price: 1000000, durationMin: 60, discountPercent: 20,
        })
        .expect(400));

    it('switching an existing FIXED service to RANGE requires both bounds in the same request', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Switchable', price: 500000, durationMin: 45 })
        .expect(201);

      // Omitting priceMax while switching type is rejected -- a type change is atomic.
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ pricingType: 'range', price: 1000000 })
        .expect(400);

      const updated = await request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ pricingType: 'range', price: 1000000, priceMax: 3000000 })
        .expect(200);
      expect(updated.body.pricingType).toBe('range');
      expect(updated.body.price).toBe(1000000);
      expect(updated.body.priceMax).toBe(3000000);
    });

    it('switching a discounted FIXED service to QUOTE clears price, priceMax, and discount automatically', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'To Be Quoted', price: 500000, durationMin: 45, discountPercent: 30 })
        .expect(201);

      const updated = await request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ pricingType: 'quote' })
        .expect(200);
      expect(updated.body.pricingType).toBe('quote');
      expect(updated.body.price).toBeNull();
      expect(updated.body.priceMax).toBeNull();
      expect(updated.body.discountPercent).toBeNull();
    });

    it('rejects durationMax below durationMin', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Bad Duration', price: 100000, durationMin: 90, durationMax: 60 })
        .expect(400));

    it('accepts a durationMax at or above durationMin (display-only estimate)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name: 'Estimated Duration', price: 100000, durationMin: 90, durationMax: 180 })
        .expect(201);
      expect(res.body.durationMin).toBe(90);
      expect(res.body.durationMax).toBe(180);
    });
  });

  describe('custom categories', () => {
    let customCategoryId: string;

    it('creates a custom category and uses it immediately, no admin approval needed', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/salons/mine/custom-categories')
        .set('Cookie', cookie)
        .send({ name: 'VIP Services' })
        .expect(201);
      customCategoryId = created.body.id;

      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ customCategoryId, name: 'Custom Category Service', price: 100000, durationMin: 30 })
        .expect(201);
      expect(res.body.customCategoryId).toBe(customCategoryId);
      expect(res.body.categoryId).toBeNull();
    });

    it('rejects a service with both categoryId and customCategoryId', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, customCategoryId, name: 'Both Categories', price: 100000, durationMin: 30 })
        .expect(400));

    it('rejects a service with neither categoryId nor customCategoryId', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ name: 'No Category', price: 100000, durationMin: 30 })
        .expect(400));

    it('rejects deleting a custom category still referenced by a service', () =>
      request(app.getHttpServer())
        .delete(`/api/salons/mine/custom-categories/${customCategoryId}`)
        .set('Cookie', cookie)
        .expect(409));

    it('rejects a duplicate custom category name for the same salon', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/custom-categories')
        .set('Cookie', cookie)
        .send({ name: 'VIP Services' })
        .expect(409));

    it('cannot use another salons custom category (tenant isolation)', async () => {
      const otherCookie = await loginAs(app, '09122220099');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherCookie).send({
        name: 'Other Salon', genderTarget: 'women', address: 'Elsewhere St', city: 'Tehran',
        lat: 35.7, lng: 51.4, categoryIds: [categoryId],
      });

      await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', otherCookie)
        .send({ customCategoryId, name: 'Stolen Category Service', price: 100000, durationMin: 30 })
        .expect(403);
    });

    it('rejects unauthenticated access to custom categories', () =>
      request(app.getHttpServer()).get('/api/salons/mine/custom-categories').expect(401));
  });
});
