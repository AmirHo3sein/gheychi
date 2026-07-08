import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon detail (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122260001');
    const ownerCookie = await loginAs(app, '09122260002');
    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Detail Test Salon',
      description: 'یک آرایشگاه نمونه',
      genderTarget: 'women',
      address: 'Somewhere St, No. 10',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 3,
    });
    salonId = createRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the full salon record for a pending salon (not just the approved-only public fields)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toMatchObject({
      id: salonId,
      name: 'Detail Test Salon',
      description: 'یک آرایشگاه نمونه',
      status: 'pending',
      address: 'Somewhere St, No. 10',
      capacity: 3,
      rejectionReason: null,
    });
  });

  it('404s an unknown salon id', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/salons/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122260099');
    await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}`)
      .set('Cookie', customerCookie)
      .expect(403);
  });
});
