import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon earnings (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220002');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Earnings Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 3',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns zeroed earnings for a brand-new salon with no bookings', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ totalCollected: 0, commissionPercent: 10, commissionAmount: 0, netPayout: 0 });
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/earnings').expect(401));
});
