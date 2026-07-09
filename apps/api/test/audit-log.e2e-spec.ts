import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('Admin audit log (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let adminId: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09127770001');

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', adminCookie).expect(200);
    adminId = me.body.id;

    const ownerCookie = await loginAs(app, '09127770002');
    const createRes = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Audit Trail Salon',
        genderTarget: 'women',
        address: 'Valiasr St, No. 12',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
      })
      .expect(201);
    salonId = createRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('captures an admin salon approval as a success row with actor identity', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/admin/audit-log').set('Cookie', adminCookie).expect(200);

    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    const row = res.body.items.find(
      (item: { action: string; targetId: string | null; success: boolean }) =>
        item.action === 'salon.status.set' && item.targetId === salonId && item.success === true,
    );
    expect(row).toBeDefined();
    expect(row.targetType).toBe('salon');
    expect(row.actorId).toBe(adminId);
    expect(row.actorPhone).toBe('09127770001');
    expect(row.payload).toEqual({ status: 'approved' });
  });

  it('captures the request body verbatim, including Farsi text', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'شکایت مشتری از بهداشت سالن' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.status.set' })
      .expect(200);

    const row = res.body.items.find(
      (item: { payload: { status?: string } | null }) => item.payload?.status === 'suspended',
    );
    expect(row).toBeDefined();
    expect(row.payload).toEqual({ status: 'suspended', reason: 'شکایت مشتری از بهداشت سالن' });
  });

  it('writes a success:false row when the mutation 404s, and still returns the 404', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${ZERO_UUID}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(404);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.status.set' })
      .expect(200);

    const row = res.body.items.find((item: { targetId: string | null }) => item.targetId === ZERO_UUID);
    expect(row).toBeDefined();
    expect(row.success).toBe(false);
  });

  it('filters by action', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/featured`)
      .set('Cookie', adminCookie)
      .send({ isFeatured: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'salon.featured.set' })
      .expect(200);

    expect(res.body.total).toBe(1);
    for (const item of res.body.items) expect(item.action).toBe('salon.featured.set');
    expect(res.body.items[0].targetId).toBe(salonId);
    expect(res.body.items[0].payload).toEqual({ isFeatured: true });
  });

  it('filters by actorId and targetType', async () => {
    // Rows so far: approve, suspend, failed 404 approve, set-featured -- all by this admin, all targeting salons.
    const mine = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: adminId })
      .expect(200);
    expect(mine.body.total).toBeGreaterThanOrEqual(4);

    const nobody = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: '11111111-1111-1111-8111-111111111111' })
      .expect(200);
    expect(nobody.body.total).toBe(0);

    const salons = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ targetType: 'salon' })
      .expect(200);
    expect(salons.body.total).toBeGreaterThanOrEqual(4);
    for (const item of salons.body.items) expect(item.targetType).toBe('salon');
  });

  it('filters by created-at window', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ from: '2000-01-01T00:00:00.000Z', to: '2000-01-02T00:00:00.000Z' })
      .expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('paginates newest-first', async () => {
    const pageOne = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ page: 1, pageSize: 1 })
      .expect(200);
    expect(pageOne.body.items).toHaveLength(1);
    expect(pageOne.body.pageSize).toBe(1);
    expect(pageOne.body.total).toBeGreaterThanOrEqual(4);

    const pageTwo = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ page: 2, pageSize: 1 })
      .expect(200);
    expect(pageTwo.body.items).toHaveLength(1);
    expect(pageTwo.body.items[0].id).not.toBe(pageOne.body.items[0].id);
    expect(new Date(pageOne.body.items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(pageTwo.body.items[0].createdAt).getTime(),
    );
  });

  it('400s a pageSize over 100 and a malformed actorId', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ pageSize: 101 })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ actorId: 'not-a-uuid' })
      .expect(400);
  });

  it('rejects non-admin callers with 403 and anonymous callers with 401', async () => {
    const customerCookie = await loginAs(app, '09127770099');
    await request(app.getHttpServer()).get('/api/admin/audit-log').set('Cookie', customerCookie).expect(403);
    await request(app.getHttpServer()).get('/api/admin/audit-log').expect(401);
  });
});
