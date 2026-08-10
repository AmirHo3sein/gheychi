import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Favorites (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let salonId: string;
  let suspendedSalonId: string;

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

    const [{ id: ownerId2 }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09140000003', 'provider') RETURNING id`,
    );
    const [{ id: suspendedId }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Suspended Favorite Salon', 'suspended-favorite-salon', 'women', 'suspended', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId2],
    );
    suspendedSalonId = suspendedId;
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

  // Regression test: GET /favorites used to have no status filter at all, so a salon
  // favorited before it was suspended (or otherwise never approved) kept showing up
  // indefinitely -- inconsistent with every other public salon listing in the platform
  // (SalonsService.findPublicBySlug, SearchService), which all gate on status='approved'.
  it('excludes a favorited salon that is not approved, while still listing an approved one', async () => {
    await request(app.getHttpServer()).post(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(201);
    await request(app.getHttpServer())
      .post(`/api/salons/${suspendedSalonId}/favorite`)
      .set('Cookie', cookie)
      .expect(201);

    const res = await request(app.getHttpServer()).get('/api/favorites').set('Cookie', cookie).expect(200);

    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(salonId);
    expect(ids).not.toContain(suspendedSalonId);

    // The technical-debt fix here is a *response* filter, not a data deletion -- the
    // underlying salon_favorites row for the suspended salon must survive untouched, so
    // that a later re-approval makes it reappear without the customer re-favoriting it.
    // Verify that directly against the DB rather than trusting the response's absence.
    const ds = testDataSource();
    await ds.initialize();
    const rows = await ds.query(
      `SELECT 1 FROM salon_favorites WHERE user_id = (SELECT id FROM users WHERE phone = $1) AND salon_id = $2`,
      ['09140000001', suspendedSalonId],
    );
    await ds.destroy();
    expect(rows).toHaveLength(1);

    // Cleanup so this test's effects don't leak into a re-run of the earlier ones.
    await request(app.getHttpServer()).delete(`/api/salons/${salonId}/favorite`).set('Cookie', cookie).expect(204);
    await request(app.getHttpServer())
      .delete(`/api/salons/${suspendedSalonId}/favorite`)
      .set('Cookie', cookie)
      .expect(204);
  });
});
