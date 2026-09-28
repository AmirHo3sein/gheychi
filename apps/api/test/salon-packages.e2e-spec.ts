import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon packages (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let categoryId: number;
  let serviceIds: string[];

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09123330000');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    categoryId = categoriesRes.body[0].id;
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Bridal Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });

    const names = ['Makeup', 'Hair Styling', 'Eyebrow', 'Nails'];
    serviceIds = [];
    for (const name of names) {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId, name, price: 500000, durationMin: 60 })
        .expect(201);
      serviceIds.push(res.body.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  let packageId: string;

  it('creates a package bundling multiple existing services', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .send({
        name: 'Bridal Package',
        description: 'Full bridal day package',
        pricingType: 'from',
        price: 2500000,
        serviceIds: serviceIds.slice(0, 3),
      })
      .expect(201);
    packageId = res.body.id;
    expect(res.body.pricingType).toBe('from');
    expect(res.body.price).toBe(2500000);
  });

  it('rejects a package with fewer than 2 services', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .send({ name: 'Too Small', serviceIds: [serviceIds[0]] })
      .expect(400));

  it('rejects a package referencing a service from another salon', async () => {
    const otherCookie = await loginAs(app, '09123330099');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherCookie).send({
      name: 'Other Salon', genderTarget: 'women', address: 'Elsewhere St', city: 'Tehran',
      lat: 35.7, lng: 51.4, categoryIds: [categoryId],
    });
    const otherService = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', otherCookie)
      .send({ categoryId, name: 'Other Service', price: 100000, durationMin: 30 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .send({ name: 'Cross Salon Package', serviceIds: [serviceIds[0], otherService.body.id] })
      .expect(400);
  });

  it('lists packages with their items', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].items.length).toBe(3);
    expect(res.body[0].items.map((i: { serviceId: string }) => i.serviceId).sort()).toEqual(
      serviceIds.slice(0, 3).sort(),
    );
  });

  it('updates a package, replacing its item list wholesale', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/packages/${packageId}`)
      .set('Cookie', cookie)
      .send({ serviceIds: [serviceIds[1], serviceIds[3]] })
      .expect(200);
    expect(res.body.id).toBe(packageId);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body[0].items.map((i: { serviceId: string }) => i.serviceId).sort()).toEqual(
      [serviceIds[1], serviceIds[3]].sort(),
    );
  });

  it('is not itself bookable -- no booking endpoint exists for a package id', () =>
    request(app.getHttpServer())
      .post('/api/bookings/hold')
      .set('Cookie', cookie)
      .send({ salonId: 'irrelevant', serviceId: packageId, startsAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect((res) => {
        // Whatever the exact status, it must not succeed as a real booking -- a package id
        // is never a valid serviceId, since packages are catalog/display-only (see
        // salon-package.entity.ts's own doc comment).
        expect(res.status).not.toBe(201);
      }));

  it('appears on the public salon page with its items', async () => {
    const salonRes = await request(app.getHttpServer())
      .get('/api/salons/mine')
      .set('Cookie', cookie)
      .expect(200);
    const slug = salonRes.body.slug;

    // Approve so the public read path (findPublicBySlug) resolves it, via the real admin
    // flow rather than reaching into internals.
    const adminCookie = await loginAsAdmin(app, '09120000000');
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonRes.body.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/packages`).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].items.length).toBe(2);
  });

  it('archives a package on delete', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/packages/${packageId}`)
      .set('Cookie', cookie)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/packages')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/packages').expect(401));
});
