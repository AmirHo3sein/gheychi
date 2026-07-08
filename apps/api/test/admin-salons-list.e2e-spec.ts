import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon list filters (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let tehranSalonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122230001');

    const ownerCookie = await loginAs(app, '09122230002');
    const tehranRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Pending Salon Tehran',
      genderTarget: 'women',
      address: 'Somewhere St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    tehranSalonId = tehranRes.body.id;

    const owner2Cookie = await loginAs(app, '09122230003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', owner2Cookie).send({
      name: 'Pending Salon Shiraz',
      genderTarget: 'men',
      address: 'Somewhere St, No. 6',
      city: 'Shiraz',
      lat: 29.6,
      lng: 52.5,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to status=pending when no filter is given', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((s: { status: string }) => s.status === 'pending')).toBe(true);
  });

  it('filters by city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?city=Shiraz')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by genderTarget', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?genderTarget=men')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by name (partial, case-insensitive)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?name=tehran')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Tehran');
  });

  it('an explicit status=approved filter overrides the pending default', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('status=all returns every status with no filtering', async () => {
    // Approve one of the two seeded salons so this request must span both
    // 'pending' and 'approved' statuses -- proving the 'all' bypass genuinely
    // disables the pending-only default, rather than the assertion happening
    // to pass because both seeded salons are still pending.
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${tehranSalonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const byName = (name: string) => res.body.find((s: { name: string }) => s.name === name);
    expect(byName('Pending Salon Tehran')?.status).toBe('approved');
    expect(byName('Pending Salon Shiraz')?.status).toBe('pending');
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122230004');
    await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', customerCookie)
      .expect(403);
  });
});
