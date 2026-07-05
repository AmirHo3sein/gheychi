import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Favorites (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09140000001');

    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09140000002', 'provider') RETURNING id`,
    );
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Favorite Test Salon', 'favorite-test-salon', 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId],
    );
    salonId = id;
    await ds.destroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts with an empty favorites list', async () => {
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual([]);
  });

  it('adds and lists a favorite', async () => {
    await request(app.getHttpServer()).post(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(201);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(salonId);
  });

  it('is idempotent when favoriting twice', async () => {
    await request(app.getHttpServer()).post(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(201);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('removes a favorite', async () => {
    await request(app.getHttpServer()).delete(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(204);
    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual([]);
  });

  it('no-ops when deleting a favorite that was never added', async () => {
    const neverFavorited = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .delete(`/api/salons/${neverFavorited}/favorite`)
      .set('Cookie', cookie)
      .expect(204);
  });
});
