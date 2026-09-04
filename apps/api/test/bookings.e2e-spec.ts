import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BOOKING_UNAVAILABLE } from '../src/booking/booking-error-codes';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { createApprovedSalonWithService, createService } from './factories/salon.factory';

describe('Bookings — create hold (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09125550001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'Booking Test Salon' },
      { price: 2000000 },
    ));

    customerCookie = await loginAs(app, '09126660002');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  it('creates a pending_payment booking with a 20% deposit and a mock payment URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);

    expect(res.body.booking.status).toBe('pending_payment');
    expect(res.body.booking.priceSnapshot).toBe(2000000);
    // deposit_min_toman is seeded at 200000, so the price here (2000000) must be high
    // enough that 20% of it (400000) genuinely exceeds the floor -- otherwise this
    // test would silently only ever exercise the minimum-floor path, not the
    // percentage path its own name claims to test.
    expect(res.body.booking.depositAmount).toBe(400000); // 20% of 2000000
    expect(res.body.paymentUrl).toContain('Authority=MOCK-');
  });

  it('persists an optional marketing-attribution source (distinct from Booking.source)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(30), attributionSource: 'qr' })
      .expect(201);

    const ds = app.get(DataSource);
    const [row] = await ds.query(`SELECT source, attribution_source FROM bookings WHERE id = $1`, [
      res.body.booking.id,
    ]);
    expect(row.source).toBe('online');
    expect(row.attribution_source).toBe('qr');
  });

  it('rejects an attribution source outside the fixed set', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(31), attributionSource: 'facebook-ads' })
      .expect(400));

  it('leaves attribution_source null when the client sends none', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(32) })
      .expect(201);

    const ds = app.get(DataSource);
    const [row] = await ds.query(`SELECT attribution_source FROM bookings WHERE id = $1`, [res.body.booking.id]);
    expect(row.attribution_source).toBeNull();
  });

  it('rejects a startsAt in the past', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(-1) })
      .expect(400));

  it('rejects a second overlapping booking once capacity (1) is full', async () => {
    const startsAt = futureIso(48);
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt })
      .expect(201);

    const secondCustomer = await loginAs(app, '09127770003');
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', secondCustomer)
      .send({ salonId, serviceId, startsAt })
      .expect(409);
    expect(res.body.code).toBe(BOOKING_UNAVAILABLE);
  });

  it('concurrency: two simultaneous bookings for the same salon capacity slot -- exactly one succeeds', async () => {
    const startsAt = futureIso(500);
    const racerA = await loginAs(app, '09121110031');
    const racerB = await loginAs(app, '09121110032');

    // Real concurrent HTTP requests (not the mocked-Redis unit test in
    // bookings.service.spec.ts, and not the sequential test above -- await-then-await
    // never actually contends for createHold's own per-salon lock) hitting a real
    // Postgres + Redis. Capacity is 1, so whichever request wins the lock's
    // check-then-insert critical section first must be the only one that gets to
    // insert; the other must see the slot already taken.
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/bookings').set('Cookie', racerA).send({ salonId, serviceId, startsAt }),
      request(app.getHttpServer()).post('/api/bookings').set('Cookie', racerB).send({ salonId, serviceId, startsAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('concurrency: N=6 simultaneous bookings against capacity K=3 -- capacity is never exceeded, and the DB always matches what HTTP reported', async () => {
    const capacitySalon = await createApprovedSalonWithService(
      app,
      await loginAs(app, '09121110040'),
      { name: 'Capacity-3 Race Salon', capacity: 3 },
      { price: 1000000 },
    );
    const startsAt = futureIso(600);

    const racers = await Promise.all(
      Array.from({ length: 6 }, (_, i) => loginAs(app, `0912111005${i}`)),
    );

    // 6 genuinely concurrent requests against a salon whose capacity is 3. The
    // per-salon Redis lock (acquireSalonLock) serializes whichever requests actually
    // acquire it into the check-then-insert critical section one at a time -- but
    // acquisition itself is single-shot with no retry, so a request that loses the
    // initial SET NX race is rejected outright rather than queued for a later turn.
    // Every winner is still guaranteed a correct, up-to-date capacity check; the
    // invariant this test proves is "never over capacity", not "always exactly at
    // capacity" -- see the assertions below.
    const results = await Promise.all(
      racers.map((cookie) =>
        request(app.getHttpServer())
          .post('/api/bookings')
          .set('Cookie', cookie)
          .send({ salonId: capacitySalon.salonId, serviceId: capacitySalon.serviceId, startsAt }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    // The one invariant that must NEVER be violated -- capacity is never exceeded.
    // Not asserted as an exact `=== 3`: acquireSalonLock (redis-lock.util.ts) is a
    // single-shot `SET NX` with deliberately no retry ("callers decide what losing
    // means" -- its own doc comment), so genuinely simultaneous requests can collide on
    // the lock itself and lose outright, independent of whether capacity was still
    // available. That is a real, timing-dependent characteristic of this lock design
    // (confirmed by direct investigation, not assumed) -- fewer than capacity succeeding
    // under a true burst is an acceptable "try again" outcome; MORE than capacity
    // succeeding would be a real double-booking bug and must never happen.
    expect(succeeded.length).toBeGreaterThan(0);
    expect(succeeded.length).toBeLessThanOrEqual(3);
    expect(succeeded.length + failed.length).toBe(6);
    for (const r of failed) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe(BOOKING_UNAVAILABLE);
    }

    // Ground truth: count SLOT_BLOCKING_STATUSES rows for this exact interval directly
    // against Postgres -- HTTP status codes alone can't prove what actually committed.
    // Must match the HTTP success count exactly (no orphaned/phantom rows) and must
    // never exceed capacity -- the two things this test actually exists to prove.
    const ds = app.get(DataSource);
    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int AS count FROM bookings
       WHERE salon_id = $1 AND status IN ('pending_approval', 'pending_payment', 'confirmed')
         AND starts_at < $2 AND ends_at > $3`,
      [capacitySalon.salonId, new Date(new Date(startsAt).getTime() + 60 * 60_000), startsAt],
    );
    expect(count).toBe(succeeded.length);
    expect(count).toBeLessThanOrEqual(3);
  });

  it('lists the caller\'s own bookings via GET /bookings/mine', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bookings/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('includes the salon and service names in the list response', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/bookings/mine')
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body[0]).toHaveProperty('salonName');
    expect(res.body[0]).toHaveProperty('serviceName');
  });

  it('fetches a single booking by id, scoped to the caller', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const bookingId = created.body.booking.id;

    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);

    const otherCustomer = await loginAs(app, '09128880004');
    await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', otherCustomer)
      .expect(404);
  });

  it('requires auth to create a booking', () =>
    request(app.getHttpServer())
      .post('/api/bookings')
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(401));

  describe('POST /bookings/:id/retry-payment', () => {
    it('returns a fresh paymentUrl for a pending_payment booking owned by the caller', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(96) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const res = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(res.body.paymentUrl).toContain('Authority=MOCK-');
    });

    it('returns 404 when the booking belongs to a different user', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(120) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const otherCustomer = await loginAs(app, '09129990005');
      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', otherCustomer)
        .expect(404);
    });

    it('returns 409 when the booking is already confirmed', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(144) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const ds = app.get(DataSource);
      await ds.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(409);
    });

    it('returns 404 for a nonexistent booking id', () =>
      request(app.getHttpServer())
        .post('/api/bookings/00000000-0000-0000-0000-000000000000/retry-payment')
        .set('Cookie', customerCookie)
        .expect(404));

    it('still honours the SUPERSEDED authority when the customer pays through their older Zarinpal tab', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(168) })
        .expect(201);
      const bookingId = created.body.booking.id;
      const firstAuthority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;

      const retried = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);
      const secondAuthority = new URL(retried.body.paymentUrl).searchParams.get('Authority')!;
      expect(secondAuthority).not.toBe(firstAuthority);

      // The first Zarinpal session stays chargeable. This used to 404 (the payment row
      // only remembers the newest authority), leaving a real deduction recorded nowhere.
      const callback = await request(app.getHttpServer())
        .get('/api/payments/callback')
        .query({ Authority: firstAuthority, Status: 'OK' })
        .expect(302);
      expect(callback.headers.location).toContain(`status=success&bookingId=${bookingId}`);

      const ds = app.get(DataSource);
      const [payment] = await ds.query(`SELECT status, authority FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payment.status).toBe('paid');
      // ...and the payment now names the session that actually captured, so a refund
      // would be issued against the right transaction.
      expect(payment.authority).toBe(firstAuthority);
    });
  });

  // Discount resolution is "larger discount wins, never stacked" (see discount.util.ts).
  // A coupon that loses that comparison must not be consumed: UNIQUE(coupon_id, user_id)
  // makes a redemption permanent, so spending it for zero benefit locks the customer out
  // of the code for life -- and for a referral-issued coupon destroys a granted reward.
  describe('coupon redemption is gated on the coupon actually winning', () => {
    let ownerCookie: string;
    let discountedServiceId: string;

    beforeAll(async () => {
      ownerCookie = await loginAs(app, '09125550001');
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      discountedServiceId = await createService(app, ownerCookie, categoriesRes.body[0].id, {
        name: 'Colour (30% off)',
        price: 2000000,
        discountPercent: 30,
      });
    });

    it('does not redeem a coupon that loses to the service discount, and leaves it reusable', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'WEAK10', discountPercent: 10 })
        .expect(201);

      const loser = await loginAs(app, '09121110021');
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', loser)
        .send({ salonId, serviceId: discountedServiceId, startsAt: futureIso(200), couponCode: 'WEAK10' })
        .expect(201);

      expect(created.body.couponApplied).toBe(false);
      expect(created.body.booking.priceSnapshot).toBe(1400000); // the service's own 30%, not 10%
      expect(created.body.booking.couponId).toBeNull();

      const ds = app.get(DataSource);
      const redemptions = await ds.query(`SELECT id FROM coupon_redemptions WHERE booking_id = $1`, [
        created.body.booking.id,
      ]);
      expect(redemptions).toHaveLength(0);

      // The whole point: the code is still available for a booking where it helps.
      await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', loser)
        .send({ code: 'WEAK10', salonId, serviceId: discountedServiceId })
        .expect(201);
    });

    it('redeems a winning coupon and records the COUPON\'s own discount amount', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'STRONG50', discountPercent: 50 })
        .expect(201);

      const winner = await loginAs(app, '09121110022');
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', winner)
        .send({ salonId, serviceId: discountedServiceId, startsAt: futureIso(224), couponCode: 'STRONG50' })
        .expect(201);

      expect(created.body.couponApplied).toBe(true);
      expect(created.body.booking.priceSnapshot).toBe(1000000); // the coupon's 50% beats 30%
      expect(created.body.booking.couponId).not.toBeNull();

      const ds = app.get(DataSource);
      const [redemption] = await ds.query(`SELECT discount_amount FROM coupon_redemptions WHERE booking_id = $1`, [
        created.body.booking.id,
      ]);
      // The coupon's own effect (2,000,000 -> 1,000,000), never the service discount's.
      expect(Number(redemption.discount_amount)).toBe(1000000);
    });
  });
});
