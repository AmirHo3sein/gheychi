import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { loginAs } from './utils/auth-helper';
import { resetDatabase, testDataSource } from './utils/db';

describe('Admin — featured salon toggle (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAs(app, '09120000001');

    const ds = testDataSource();
    await ds.initialize();
    await ds.query(`UPDATE users SET role = 'admin' WHERE phone = '09120000001'`);
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09120000002', 'provider') RETURNING id`,
    );
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Test Salon', 'test-salon-admin', 'women', 'approved', 'addr', 'Tehran',
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

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09120000003');
    await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', customerCookie)
      .expect(403);
  });

  it('lists approved salons for an admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.find((s: { id: string }) => s.id === salonId)).toBeDefined();
  });

  it('excludes salons that are not approved', async () => {
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09120000004', 'provider') RETURNING id`,
    );
    const [{ id: pendingId }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Pending Salon', 'pending-salon-admin', 'women', 'pending', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId],
    );
    await ds.destroy();

    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.find((s: { id: string }) => s.id === pendingId)).toBeUndefined();
  });

  it('toggles a salon to featured with an expiry', async () => {
    const featuredUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/featured`)
      .set('Cookie', adminCookie)
      .send({ isFeatured: true, featuredUntil })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    const updated = res.body.find((s: { id: string }) => s.id === salonId);
    expect(updated.isFeatured).toBe(true);
    expect(updated.featuredUntil).toBe(featuredUntil);
  });

  it('returns 404 for a well-formed but unknown salon id', async () => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${unknownId}/featured`)
      .set('Cookie', adminCookie)
      .send({ isFeatured: true })
      .expect(404);
  });
});
