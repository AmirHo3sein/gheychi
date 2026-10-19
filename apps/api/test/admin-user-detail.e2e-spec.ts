import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('GET /admin/users/:id (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let adminId: string;
  let customerCookie: string;
  let customerId: string;
  let ownerId: string;
  let salonId: string;
  let bookingId: string;

  const detail = (id: string, cookie = adminCookie) => request(app.getHttpServer()).get(`/api/admin/users/${id}`).set('Cookie', cookie);
  const idOf = async (phone: string) =>
    (await request(app.getHttpServer()).get(`/api/admin/users?phone=${phone}`).set('Cookie', adminCookie).expect(200)).body.items[0].id as string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09124440001');
    const ownerCookie = await loginAs(app, '09124440002');
    customerCookie = await loginAs(app, '09124440003');
    await app.get(DataSource).query(`UPDATE users SET name = 'مشتری جزئیات', gender = 'female' WHERE phone = '09124440003'`);
    adminId = await idOf('09124440001');
    ownerId = await idOf('09124440002');
    customerId = await idOf('09124440003');

    const salon = await createApprovedSalonWithService(app, ownerCookie, { name: 'سالن جزئیات' }, { name: 'کوتاهی', price: 300_000, durationMin: 30 });
    salonId = salon.salonId;
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId: salon.serviceId, startsAt: new Date(Date.now() + 26 * 3600_000).toISOString() })
      .expect(201);
    bookingId = res.body.booking.id;

    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: customerId, amount: 50_000, reason: 'جبران تاخیر' })
      .expect(201);
    for (const status of ['suspended', 'active']) {
      await request(app.getHttpServer()).patch(`/api/admin/users/${customerId}/status`).set('Cookie', adminCookie).send({ status }).expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a customer's profile, bookings, wallet and the admin actions taken on the account", async () => {
    const { body } = await detail(customerId).expect(200);
    expect(body.user).toEqual(expect.objectContaining({ id: customerId, phone: '09124440003', name: 'مشتری جزئیات', gender: 'female', role: 'customer', status: 'active' }));
    expect(body.salon).toBeNull();
    expect(body.workerAt).toEqual([]);
    expect(body.bookings.total).toBe(1);
    expect(Object.values(body.bookings.byStatus).reduce((a: number, b) => a + (b as number), 0)).toBe(1);
    expect(body.bookings.recent).toEqual([
      expect.objectContaining({ id: bookingId, salonId, salonName: 'سالن جزئیات', serviceName: 'کوتاهی', priceSnapshot: 300_000 }),
    ]);
    expect(body.wallet).toEqual({ toman: 50_000, points: 0 });
    expect(body.reviewsCount).toBe(0);

    // Newest first: reactivate, suspend, then the wallet credit.
    expect(body.activity.map((a: { action: string }) => a.action)).toEqual(['user.status.set', 'user.status.set', 'wallet.adjust']);
    expect(body.activity[0]).toEqual(expect.objectContaining({ status: 'active', success: true, actor: expect.objectContaining({ id: adminId, phone: '09124440001' }) }));
    expect(body.activity[1].status).toBe('suspended');
    expect(body.activity[2]).toEqual(expect.objectContaining({ amount: 50_000, currency: 'toman', reason: 'جبران تاخیر', status: null }));
  });

  it("shows the salon an owner runs, and none of another account's activity", async () => {
    const { body } = await detail(ownerId).expect(200);
    expect(body.user.role).toBe('provider');
    expect(body.salon).toEqual(expect.objectContaining({ id: salonId, name: 'سالن جزئیات', status: 'approved' }));
    expect(body.bookings.total).toBe(0);
    expect(body.activity).toEqual([]);
  });

  it('404s an unknown id, 400s a malformed one, and refuses a non-admin', async () => {
    await detail('00000000-0000-4000-8000-000000000000').expect(404);
    await detail('not-a-uuid').expect(400);
    await detail(customerId, customerCookie).expect(403);
  });
});
