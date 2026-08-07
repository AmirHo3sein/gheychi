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
});
