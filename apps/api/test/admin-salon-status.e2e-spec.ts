import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon status transitions (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122240001');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ownerPhone = `0912224${Math.floor(1000 + Math.random() * 8999)}`;
    const ownerCookie = await loginAs(app, ownerPhone);
    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: `Status Test Salon ${ownerPhone}`,
      genderTarget: 'women',
      address: 'Somewhere St, No. 7',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = createRes.body.id;
  });

  it('approves a pending salon with no reason required', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('approves a pending salon with an explicit empty-string reason', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved', reason: '' })
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('approves a pending salon with a null reason', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved', reason: null })
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('rejects a pending salon and stores the reason', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'آدرس نامعتبر است' })
      .expect(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejectionReason).toBe('آدرس نامعتبر است');
  });

  it('400s a reject with no reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(400);
  });

  it('suspends an already-approved salon and stores the reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'شکایت مشتری' })
      .expect(200);
    expect(res.body.status).toBe('suspended');
    expect(res.body.rejectionReason).toBe('شکایت مشتری');
  });

  it('400s a suspend with no reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(400);
  });

  it('404s an unknown salon id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/salons/00000000-0000-0000-0000-000000000000/status')
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122240099');
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', customerCookie)
      .send({ status: 'approved' })
      .expect(403);
  });
});
