import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const salonPayload = {
  name: 'Rose Beauty',
  genderTarget: 'women',
  address: 'Valiasr St, No. 100',
  city: 'Tehran',
  lat: 35.7219,
  lng: 51.3347,
  capacity: 2,
};

describe('Salons (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let categoryId: number;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09121110000');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    categoryId = categoriesRes.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a salon (status pending) and promotes the owner to provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', cookie)
      .send({ ...salonPayload, categoryIds: [categoryId] })
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.slug).toMatch(/^rose-beauty-[0-9a-f]{4}$/);

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.role).toBe('provider');
  });

  it('rejects a second salon for the same owner', () =>
    request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({ ...salonPayload, categoryIds: [categoryId] }).expect(409));

  it('returns my salon and updates it', async () => {
    const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
    expect(mine.body.name).toBe('Rose Beauty');

    const upd = await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', cookie)
      .send({ capacity: 3 })
      .expect(200);
    expect(upd.body.capacity).toBe(3);
  });

  it('rejects a description over the 2000-char cap, on both create and update', async () => {
    const tooLong = 'a'.repeat(2001);
    await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', cookie)
      .send({ description: tooLong })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', await loginAs(app, '09121110099'))
      .send({ ...salonPayload, categoryIds: [categoryId], description: tooLong })
      .expect(400);
  });

  it('hides pending salons from the public route, shows approved ones', async () => {
    const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).get(`/api/salons/${mine.body.slug}`).expect(404);

    await app.get(DataSource).query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [mine.body.id]);

    const pub = await request(app.getHttpServer()).get(`/api/salons/${mine.body.slug}`).expect(200);
    expect(pub.body.name).toBe('Rose Beauty');
  });

  it('requires auth to create', () =>
    request(app.getHttpServer()).post('/api/salons').send({ ...salonPayload, categoryIds: [categoryId] }).expect(401));
});
