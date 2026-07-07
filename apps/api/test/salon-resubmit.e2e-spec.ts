import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon resubmit after rejection (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122250001');
    ownerCookie = await loginAs(app, '09122250002');

    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Resubmit Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 8',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = createRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'اطلاعات ناقص است' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a resubmit from a non-rejected status', async () => {
    const otherOwnerCookie = await loginAs(app, '09122250003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
      name: 'Pending Salon, not rejected',
      genderTarget: 'men',
      address: 'Somewhere St, No. 9',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', otherOwnerCookie)
      .expect(400);
  });

  it('flips a rejected salon back to pending and clears the reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', ownerCookie)
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('rejects an unauthenticated caller', async () =>
    request(app.getHttpServer()).post('/api/salons/mine/resubmit').expect(401));
});
