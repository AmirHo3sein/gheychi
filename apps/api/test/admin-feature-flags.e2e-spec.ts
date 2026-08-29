import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin feature flags (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122310002');
  });

  afterAll(async () => {
    await app.close();
  });

  // onlinePaymentEnabled is the one flag seeded false, not true (a real production launch
  // decision -- see docs/technical-overview/29-global-payment-toggle.md) -- every other flag
  // stays "on by default" (unchanged pre-existing behavior until an admin opts out).
  it('the public endpoint returns all 6 flags, true by default except online payment (no auth required)', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
    expect(res.body).toEqual({
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
      onlinePaymentEnabled: false,
    });
  });

  it('admin can read the same flags at /admin/feature-flags', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/feature-flags')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.reviewsEnabled).toBe(true);
  });

  it('admin can partially update flags, and the public read reflects it immediately', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/feature-flags')
      .set('Cookie', adminCookie)
      .send({ storiesEnabled: false })
      .expect(200);

    const publicRes = await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
    expect(publicRes.body).toEqual({
      reviewsEnabled: true,
      storiesEnabled: false,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
      onlinePaymentEnabled: false,
    });

    // restore for later tests in this file / other e2e files sharing the same DB
    await request(app.getHttpServer())
      .patch('/api/admin/feature-flags')
      .set('Cookie', adminCookie)
      .send({ storiesEnabled: true })
      .expect(200);
  });

  it('rejects a non-boolean value', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/feature-flags')
      .set('Cookie', adminCookie)
      .send({ reviewsEnabled: 'nope' })
      .expect(400);
  });

  it('rejects a non-admin caller on both read and write', async () => {
    const customerCookie = await loginAs(app, '09122310098');
    await request(app.getHttpServer()).get('/api/admin/feature-flags').set('Cookie', customerCookie).expect(403);
    await request(app.getHttpServer())
      .patch('/api/admin/feature-flags')
      .set('Cookie', customerCookie)
      .send({ reviewsEnabled: false })
      .expect(403);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app.getHttpServer()).get('/api/admin/feature-flags').expect(401);
  });
});
