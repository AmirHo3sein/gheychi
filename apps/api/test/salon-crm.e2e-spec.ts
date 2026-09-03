import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
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

      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        name: 'مشتری وفادار',
        bookingsCount: 1,
        completedCount: 1,
        grossValue: 1_000_000, // full price, NOT the 200,000 deposit
        segment: 'new', // exactly one booking so far
      });
    });

    /**
     * The correctness fix this endpoint's rewrite was really about. The fixture booking is
     * scheduled 24 hours from now and was marked `completed` by the salon; the OLD query was
     * a bare MAX(starts_at) over every status, so it reported a "last visit" that is still
     * in the future. A visit must be something that has actually happened.
     */
    it('never reports a future appointment as a past visit', async () => {
      const res = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);

      expect(res.body.items[0]).toMatchObject({
        completedCount: 1, // the salon really did mark it completed
        visitsCount: 0, // ...but the appointment itself has not happened yet
        firstVisitAt: null,
        lastVisitAt: null,
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
      const customerId = listRes.body.items[0].userId;

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
      customerId = listRes.body.items[0].userId;
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

    // The sibling test above only proves SalonOwnerGuard's earlier gate (that caller has no
    // salon at all). This is the actual cross-tenant boundary CRM's own `WHERE salon_id = $1`
    // scoping exists to enforce: a SECOND real, approved salon with a SECOND real customer
    // (a genuine booking, not a bare user row), read by the FIRST salon's owner -- who does
    // own a salon, just not this customer's.
    it('a real salon owner cannot read or note a customer who genuinely belongs to a DIFFERENT salon', async () => {
      const rivalOwnerCookie = await loginAs(app, '09151110005');
      const { salonId: rivalSalonId, serviceId: rivalServiceId } = await createApprovedSalonWithService(
        app,
        rivalOwnerCookie,
        { name: 'Rival CRM Salon' },
        { price: 500_000 },
      );
      const rivalCustomerCookie = await loginAs(app, '09151110006');
      const rivalBooking = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', rivalCustomerCookie)
        .send({ salonId: rivalSalonId, serviceId: rivalServiceId, startsAt: futureIso(24) })
        .expect(201);
      const rivalAuthority = new URL(rivalBooking.body.paymentUrl).searchParams.get('Authority')!;
      await request(app.getHttpServer())
        .get('/api/payments/callback')
        .query({ Authority: rivalAuthority, Status: 'OK' })
        .expect(302);

      // Sanity: the rival owner genuinely sees this customer through their OWN salon's CRM.
      const rivalList = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .set('Cookie', rivalOwnerCookie)
        .expect(200);
      expect(rivalList.body.items).toHaveLength(1);
      const rivalCustomerId = rivalList.body.items[0].userId;

      // The original salon's owner (ownerCookie) DOES own a real salon -- SalonOwnerGuard
      // lets them through -- but this customer belongs only to the rival salon.
      await request(app.getHttpServer())
        .get(`/api/salons/mine/customers/${rivalCustomerId}`)
        .set('Cookie', ownerCookie)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${rivalCustomerId}/notes`)
        .set('Cookie', ownerCookie)
        .send({ note: 'نفوذ واقعی بین دو سالن' })
        .expect(404);

      // And the reverse direction: the rival owner cannot reach the original salon's real
      // customer either -- the scoping is symmetric, not a one-off special case.
      await request(app.getHttpServer())
        .get(`/api/salons/mine/customers/${customerId}`)
        .set('Cookie', rivalOwnerCookie)
        .expect(404);
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

    it('reports the operational counts alongside the money figures', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/dashboard-summary')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body).toMatchObject({
        distinctCustomers: 1,
        newCustomers: 1, // their first-ever booking here falls in the window
        returningCustomers: 0,
        completedCount: 1,
        cancelledCount: 0,
        noShowCount: 0,
        averageBookingValue: 1_000_000,
        repeatRatePercent: 0,
      });
    });

    it('compares against the immediately-preceding window of the same length', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/dashboard-summary')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(new Date(res.body.previous.to).toISOString()).toBe(new Date(res.body.from).toISOString());
      expect(res.body.previous.bookingsCount).toBe(0); // nothing existed before this suite ran
    });

    it('breaks the period down by service, and reports no busiest time for appointments that have not happened yet', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/dashboard-summary')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.topServices).toHaveLength(1);
      expect(res.body.topServices[0]).toMatchObject({ serviceId, bookingsCount: 1, grossValue: 1_000_000 });
      expect(res.body.topWorkers).toEqual([]); // the booking has no worker assigned
      // busiest weekday/hour window on starts_at, and this salon's only appointment is 24h
      // out -- "when are you busy" is about appointments that have actually happened.
      expect(res.body.busiestWeekday).toBeNull();
      expect(res.body.busiestHour).toBeNull();
    });
  });

  describe('GET /salons/mine/funnel', () => {
    /**
     * Analytics writes are deliberately fire-and-forget (never awaited by the request that
     * triggers them), so the row can land a tick after the response. Poll rather than sleep
     * a fixed amount -- a fixed sleep is either flaky or slow, and usually both.
     */
    async function funnelUntil(predicate: (body: any) => boolean, attempts = 40): Promise<any> {
      let last: any;
      for (let i = 0; i < attempts; i++) {
        const res = await request(app.getHttpServer()).get('/api/salons/mine/funnel').set('Cookie', ownerCookie).expect(200);
        last = res.body;
        if (predicate(last)) return last;
        await new Promise((r) => setTimeout(r, 50));
      }
      return last;
    }

    it('counts a public salon-profile view as the top of the funnel', async () => {
      const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie).expect(200);
      await request(app.getHttpServer()).get(`/api/salons/${mine.body.slug}`).expect(200);

      const body = await funnelUntil((b) => b.stages[0].count > 0);
      expect(body.stages[0]).toMatchObject({ stage: 'salon_profile_viewed' });
      expect(body.stages[0].count).toBeGreaterThan(0);
    });

    it('reports the booking stages from the real booking flow, with conversion off the stage before', async () => {
      const body = await funnelUntil((b) => b.stages[1].count > 0);

      expect(body.stages.map((s: { stage: string }) => s.stage)).toEqual([
        'salon_profile_viewed',
        'booking_started',
        'payment_succeeded',
        'booking_confirmed',
      ]);
      // payment_succeeded joined the funnel once its emit site started attaching salonId
      // (2026-09-03). This suite's booking is really paid through the mock gateway
      // callback, so the stage carries a real count rather than the hard zero it reported
      // while the event was unattributable.
      expect(body.stages).toHaveLength(4);
      expect(body.stages[1].count).toBeGreaterThan(0);
      expect(body.stages[2].count).toBeGreaterThan(0);
      expect(body.stages[3].conversionFromPreviousPercent).toBe(100);
    });

    it('never leaks another salon\'s events', async () => {
      const otherOwner = await loginAs(app, '09151110020');
      await createApprovedSalonWithService(app, otherOwner, { name: 'Other Funnel Salon' }, { price: 100_000 });

      const res = await request(app.getHttpServer()).get('/api/salons/mine/funnel').set('Cookie', otherOwner).expect(200);

      expect(res.body.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
    });

    it('rejects an unauthenticated caller', () => request(app.getHttpServer()).get('/api/salons/mine/funnel').expect(401));
  });

  describe('GET /salons/mine/customers — search, filter, sort, pagination', () => {
    let pastCustomerId: string;

    beforeAll(async () => {
      // A second customer with a booking that genuinely already happened, so first/last
      // visit and the lapsed heuristic have real data to key off. Inserted directly: the
      // booking API refuses to create an appointment in the past, which is exactly right,
      // but leaves no way to build a visit history through it.
      const cookie = await loginAs(app, '09151110010');
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
      pastCustomerId = me.body.id;
      await ds.query(`UPDATE users SET name = 'مشتری قدیمی' WHERE id = $1`, [pastCustomerId]);
      await ds.query(
        `INSERT INTO bookings (salon_id, user_id, service_id, worker_id, starts_at, ends_at, status, price_snapshot, deposit_amount, source)
         SELECT $1, $2, $3, NULL, now() - interval '90 days', now() - interval '90 days' + interval '30 minutes',
                'completed', 300000, 0, 'manual'
         FROM salon_services s WHERE s.id = $3`,
        [salonId, pastCustomerId, serviceId],
      );
      await ds.query(
        `INSERT INTO bookings (salon_id, user_id, service_id, worker_id, starts_at, ends_at, status, price_snapshot, deposit_amount, source)
         SELECT $1, $2, $3, NULL, now() - interval '80 days', now() - interval '80 days' + interval '30 minutes',
                'confirmed', 300000, 0, 'manual'
         FROM salon_services s WHERE s.id = $3`,
        [salonId, pastCustomerId, serviceId],
      );
    });

    it('reports first/last visit from past, non-cancelled bookings and segments off them', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ q: 'قدیمی' })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      const customer = res.body.items[0];
      expect(customer).toMatchObject({ userId: pastCustomerId, bookingsCount: 2, visitsCount: 2, segment: 'lapsed' });
      // A still-`confirmed` past booking counts as a visit too -- many salons never mark
      // completion, and excluding it would make their whole customer base look lapsed.
      expect(new Date(customer.firstVisitAt).getTime()).toBeLessThan(new Date(customer.lastVisitAt).getTime());
    });

    it('searches by phone as well as name', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ q: '09151110010' })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].userId).toBe(pastCustomerId);
    });

    it('treats a LIKE wildcard as literal text rather than "match everything"', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ q: '%' })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.total).toBe(0);
    });

    it('filters by segment', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ segment: 'lapsed' })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.items.map((c: { userId: string }) => c.userId)).toEqual([pastCustomerId]);
    });

    it('paginates, with the total reflecting all matches rather than the page', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ page: 1, pageSize: 1 })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(2);

      const second = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ page: 2, pageSize: 1 })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].userId).not.toBe(res.body.items[0].userId);
    });

    it('sorts by total value on request, independently of the default recency order', async () => {
      // Default (recency) order puts the past-visit customer first; by value the
      // 1,000,000 customer outranks their 2 x 300,000, so this really is a different order.
      const byValue = await request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ sort: 'value' })
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(byValue.body.items.map((c: { grossValue: number }) => c.grossValue)).toEqual([1_000_000, 600_000]);

      const byRecency = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);
      expect(byRecency.body.items[0].userId).toBe(pastCustomerId);
    });

    it('rejects an unknown sort key rather than interpolating it', () =>
      request(app.getHttpServer())
        .get('/api/salons/mine/customers')
        .query({ sort: 'gross_value; DROP TABLE bookings' })
        .set('Cookie', ownerCookie)
        .expect(400));
  });

  describe('entitlements.crmCustomerCap', () => {
    it('bounds the customer list (and its reported total) to an admin-configured cap, then restores when cleared', async () => {
      const adminCookie = await loginAsAdmin(app, '09151110099');

      const before = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);
      expect(before.body.total).toBe(2); // both fixture customers, unlimited by default

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: { crmCustomerCap: 1 } })
        .expect(200);

      const capped = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);
      expect(capped.body.total).toBe(1);
      expect(capped.body.items).toHaveLength(1);

      // Cleared back to unlimited so this doesn't leak into any other case sharing this salon.
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: null })
        .expect(200);

      const restored = await request(app.getHttpServer()).get('/api/salons/mine/customers').set('Cookie', ownerCookie).expect(200);
      expect(restored.body.total).toBe(2);
    });
  });
});
