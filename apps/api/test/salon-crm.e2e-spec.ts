import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * Salon-scoped CRM (Phase 5 of the monetization initiative -- see
 * docs/technical-overview/32-salon-crm.md). Entirely derived from real bookings/payments/
 * financial_transactions rows created through the actual booking flow (not raw SQL seeds),
 * so this is also the real proof that the aggregation SQL matches the live schema.
 */
describe('Salon CRM (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let customerCookie: string;
  let strangerCookie: string;
  let salonId: string;
  let serviceId: string;
  let bookingId: string;

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09151110001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'CRM Test Salon' },
      { price: 1_000_000 },
    ));
    customerCookie = await loginAs(app, '09151110002');
    strangerCookie = await loginAs(app, '09151110003');

    // Real customer name, so the CRM list has something to show -- customers don't set a
    // name at signup, only via /users/me (not exercised elsewhere in this fixture chain).
    await ds.query(`UPDATE users SET name = 'مشتری وفادار' WHERE phone = '09151110002'`);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    bookingId = created.body.booking.id;
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /salons/mine/customers', () => {
    it('lists the customer with real aggregated figures, not per-booking N+1 data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        name: 'مشتری وفادار',
        bookingsCount: 1,
        completedCount: 1,
        grossValue: 1_000_000, // full price, NOT the 200,000 deposit
        segment: 'new', // exactly one booking so far
      });
    });

    it('rejects a non-owner (a customer with no salon)', () =>
      request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', customerCookie).expect(404));

    it('rejects an unauthenticated caller', () =>
      request(app.getHttpServer()).get('/api/salons/mine/customers').expect(401));
  });

  describe('GET /salons/mine/customers/:customerId', () => {
    it('returns the customer, their booking history at this salon, and an empty notes list', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .set('Cookie', ownerCookie)
        .expect(200);
      const customerId = listRes.body[0].userId;

      const res = await request(app.getHttpServer())
        .get(`/api/salons/mine/customers/${customerId}`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.customer.name).toBe('مشتری وفادار');
      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.bookings[0]).toMatchObject({ status: 'completed', priceSnapshot: 1_000_000 });
      expect(res.body.notes).toEqual([]);
    });

    it('404s for a real user who has never booked at this salon (ownership isolation, not just a 403)', async () => {
      const strangerRes = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', strangerCookie).expect(200);
      await request(app.getHttpServer())
        .get(`/api/salons/mine/customers/${strangerRes.body.id}`)
        .set('Cookie', ownerCookie)
        .expect(404);
    });
  });

  describe('customer notes', () => {
    let customerId: string;

    beforeAll(async () => {
      const listRes = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);
      customerId = listRes.body[0].userId;
    });

    it('adds a note and shows it back on the customer detail', async () => {
      const addRes = await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/notes`)
        .set('Cookie', ownerCookie)
        .send({ note: 'همیشه دیر می‌رسد' })
        .expect(201);
      expect(addRes.body.note).toBe('همیشه دیر می‌رسد');

      const detail = await request(app.getHttpServer())
        .get(`/api/salons/mine/customers/${customerId}`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(detail.body.notes).toHaveLength(1);
      expect(detail.body.notes[0].note).toBe('همیشه دیر می‌رسد');
    });

    it('rejects an empty note', () =>
      request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/notes`)
        .set('Cookie', ownerCookie)
        .send({ note: '' })
        .expect(400));

    it('deletes a note, and refuses to delete it a second time', async () => {
      const addRes = await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/notes`)
        .set('Cookie', ownerCookie)
        .send({ note: 'برای حذف' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/salons/mine/customers/${customerId}/notes/${addRes.body.id}`)
        .set('Cookie', ownerCookie)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/api/salons/mine/customers/${customerId}/notes/${addRes.body.id}`)
        .set('Cookie', ownerCookie)
        .expect(404);
    });

    it('another salon owner cannot add a note against a customer that is not theirs', async () => {
      const otherOwnerCookie = await loginAs(app, '09151110004');
      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/notes`)
        .set('Cookie', otherOwnerCookie)
        .send({ note: 'نفوذ' })
        .expect(404); // no salon of their own at all -- SalonOwnerGuard itself 404s first
    });
  });

  describe('GET /salons/mine/dashboard-summary', () => {
    it('reports gross booking value, online collected, commission, and estimated revenue as distinct, honest figures', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/dashboard-summary')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.grossBookingValue).toBe(1_000_000); // full price
      expect(res.body.onlineCollected).toBe(200_000); // deposit only
      expect(res.body.commission).toBe(20_000); // 10% of the deposit, not the full price
      expect(res.body.estimatedSalonRevenue).toBe(980_000); // gross - commission
      expect(res.body.bookingsCount).toBe(1);
    });

    it('respects an explicit from/to range, excluding activity outside it', async () => {
      const farFuture = new Date(Date.now() + 400 * 86_400_000).toISOString();
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/dashboard-summary')
        .query({ from: farFuture, to: new Date(Date.now() + 401 * 86_400_000).toISOString() })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body).toMatchObject({ grossBookingValue: 0, onlineCollected: 0, commission: 0, estimatedSalonRevenue: 0, bookingsCount: 0 });
    });
  });
});
