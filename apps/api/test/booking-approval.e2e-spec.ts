import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BookingApprovalExpiryJob } from '../src/booking/booking-approval-expiry.job';
import { BOOKING_UNAVAILABLE, WORKER_UNAVAILABLE } from '../src/booking/booking-error-codes';
import { BookingExpiryJob } from '../src/booking/booking-expiry.job';
import { PaymentReconciliationJob } from '../src/booking/payment-reconciliation.job';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end coverage of the OPTIONAL manual booking-approval workflow.
 *
 * The invariant threaded through nearly every case here: in manual mode NO money moves
 * until the salon says yes. A rejected or timed-out request must therefore never produce a
 * Payment row, never owe a refund, and always hand back whatever the customer staked
 * (coupon code, wallet balance) on the request.
 */
describe('Booking approval workflow (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;

  const futureIso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

  /** Puts the salon into manual-approval mode through the real provider-facing route. */
  async function setMode(mode: 'automatic' | 'manual_approval') {
    await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ bookingConfirmationMode: mode })
      .expect(200);
  }

  // Deliberately NOT async: callers chain supertest's own .expect(status) off it, which
  // only exists on the Test object, not on a Promise the helper already awaited.
  function book(startsAt: string, cookie = customerCookie, extra: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', cookie)
      .send({ salonId, serviceId, startsAt, ...extra });
  }

  const statusOf = async (id: string): Promise<string> => {
    const [row] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [id]);
    return row.status;
  };

  // Asserted through the console SMS provider's own log line rather than by mocking:
  // SMS_PROVIDER=console in .env.test, so every real send is observable here, and this
  // pins actual delivery rather than an intention to deliver. Shared across describe
  // blocks (SMS budget, and the availability-recheck notification copy).
  function captureSms(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = (require('@nestjs/common') as any).Logger.prototype;
    const original = proto.log;
    proto.log = function patched(message: unknown, ...rest: unknown[]) {
      lines.push(String(message));
      return original.call(this, message, ...rest);
    };
    return { lines, restore: () => { proto.log = original; } };
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09171110001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'Approval Flow Salon' },
      { price: 2_000_000 },
    ));
    customerCookie = await loginAs(app, '09171110002');
    adminCookie = await loginAsAdmin(app, '09171110003');
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Scenario 1: the existing automatic flow is untouched --------------------------
  describe('automatic mode (regression -- must behave exactly as before)', () => {
    beforeAll(() => setMode('automatic'));

    it('still goes straight to pending_payment with a real gateway session', async () => {
      const res = await book(futureIso(200)).expect(201);

      expect(res.body.booking.status).toBe('pending_payment');
      expect(res.body.paymentRequired).toBe(true);
      expect(res.body.paymentUrl).toContain('Authority=MOCK-');
      expect(res.body.booking.confirmationMode).toBe('automatic');
      // The payment deadline is now snapshotted at creation rather than recomputed from
      // live config at expiry time.
      expect(res.body.booking.paymentExpiresAt).toBeTruthy();
      expect(res.body.booking.approvalExpiresAt).toBeNull();
    });
  });

  // --- Scenarios 2, 3, 4: the manual lifecycle ---------------------------------------
  describe('manual mode', () => {
    beforeAll(() => setMode('manual_approval'));

    it('creates a pending_approval request with NO payment session and NO Payment row', async () => {
      const res = await book(futureIso(201)).expect(201);
      const bookingId = res.body.booking.id;

      expect(res.body.booking.status).toBe('pending_approval');
      expect(res.body.booking.confirmationMode).toBe('manual_approval');
      // Rule D: the customer is never sent to Zarinpal before the salon accepts.
      expect(res.body.paymentRequired).toBe(false);
      expect(res.body.paymentUrl).not.toContain('Authority=');
      expect(res.body.booking.approvalExpiresAt).toBeTruthy();
      expect(res.body.booking.paymentExpiresAt).toBeNull();

      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(0);
    });

    it('blocks the same slot from another customer while the request is still pending', async () => {
      const startsAt = futureIso(202);
      await book(startsAt).expect(201);

      const other = await loginAs(app, '09171110004');
      // Capacity is 1, so a pending_approval request must occupy the slot exactly as a
      // paid booking would -- otherwise the salon could approve a request it has no room for.
      await book(startsAt, other).expect(409);
    });

    it('hides the slot from public availability while the request is pending', async () => {
      // Book a slot the endpoint ITSELF offered, rather than an arbitrary future instant.
      // Slots sit on a fixed grid aligned to the salon's opening time, so an ad-hoc
      // `now + N hours` value would never appear in the response to begin with and the
      // "is it gone?" assertion below could not fail for the right reason -- or any reason.
      const listSlots = async (): Promise<string[]> => {
        const res = await request(app.getHttpServer())
          .get(`/api/salons/${salonId}/availability`)
          .query({ serviceId })
          .expect(200);
        return (res.body as Array<{ slots: string[] }>).flatMap((day) => day.slots);
      };

      const before = await listSlots();
      // Pick from the far end: the near slots are contended by this file's other cases.
      const target = before[before.length - 1]!;
      expect(target).toBeTruthy();

      await book(target).expect(201);

      const after = await listSlots();
      expect(before).toContain(target);
      expect(after).not.toContain(target);
    });

    it('approve opens the payment window, creates the Payment row, and stamps a payment deadline', async () => {
      const created = await book(futureIso(204)).expect(201);
      const bookingId = created.body.booking.id;

      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.status).toBe('pending_payment');
      expect(res.body.paymentExpiresAt).toBeTruthy();

      const payments = await ds.query(`SELECT status FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('initiated');
    });

    it('completes the full manual happy path: request -> approve -> pay -> confirmed', async () => {
      const created = await book(futureIso(205)).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      // The customer now mints their gateway session through the existing route.
      const retry = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);
      const authority = new URL(retry.body.paymentUrl).searchParams.get('Authority')!;
      expect(authority).toMatch(/^MOCK-/);

      await request(app.getHttpServer())
        .get('/api/payments/callback')
        .query({ Authority: authority, Status: 'OK' })
        .expect(302);

      expect(await statusOf(bookingId)).toBe('confirmed');
    });

    it('reject requires a reason, moves to rejected_by_salon, and frees the slot', async () => {
      const startsAt = futureIso(206);
      const created = await book(startsAt).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .set('Cookie', ownerCookie)
        .send({})
        .expect(400); // reason is required

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'در آن ساعت آرایشگر در دسترس نیست' })
        .expect(200);

      expect(await statusOf(bookingId)).toBe('rejected_by_salon');
      // Nothing was ever captured, so no refund is owed and no Payment row exists.
      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(0);

      // The slot is genuinely released -- someone else can now take it.
      const other = await loginAs(app, '09171110005');
      await book(startsAt, other).expect(201);
    });

    it('a customer may withdraw their own pending request, with no refund machinery involved', async () => {
      const created = await book(futureIso(207)).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', customerCookie)
        .expect(200);

      expect(await statusOf(bookingId)).toBe('cancelled_by_user');
    });
  });

  // --- Concurrency / CAS -------------------------------------------------------------
  describe('state-transition safety', () => {
    beforeAll(() => setMode('manual_approval'));

    it('409s on a second approve -- exactly one decision can win', async () => {
      const created = await book(futureIso(210)).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(409);
    });

    it('409s when rejecting a request that was already approved', async () => {
      const created = await book(futureIso(211)).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'too late' })
        .expect(409);
    });

    it('lets exactly one of two concurrent approve calls win', async () => {
      const created = await book(futureIso(212)).expect(201);
      const bookingId = created.body.booking.id;

      const results = await Promise.all(
        [0, 1].map(() =>
          request(app.getHttpServer())
            .post(`/api/salons/mine/bookings/${bookingId}/approve`)
            .set('Cookie', ownerCookie),
        ),
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 409]);
      // Exactly one payment row -- a double-approve must never open two payment windows.
      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(1);
    });

    it("another salon's owner cannot approve this salon's request", async () => {
      const created = await book(futureIso(213)).expect(201);
      const bookingId = created.body.booking.id;

      const intruderCookie = await loginAs(app, '09171110006');
      await createApprovedSalonWithService(app, intruderCookie, { name: 'Intruder Salon' }, { price: 100_000 });

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', intruderCookie)
        .expect(404);
      expect(await statusOf(bookingId)).toBe('pending_approval');
    });

    it('rejects an unauthenticated caller on both decision routes', async () => {
      const created = await book(futureIso(214)).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer()).post(`/api/salons/mine/bookings/${bookingId}/approve`).expect(401);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .send({ reason: 'x' })
        .expect(401);
    });
  });

  // --- approve() re-checks availability -- platform state can move between the request
  // and the salon's decision, and an approval must never open a payment window for a slot
  // that no longer fits. A dedicated salon (capacity 2, two workers) so these cases don't
  // fight the shared salonId/serviceId for a chair.
  describe('approve() re-checks availability before opening the payment window', () => {
    let recheckOwnerCookie: string;
    let recheckSalonId: string;
    let recheckServiceId: string;
    let worker1Id: string;
    let worker2Id: string;

    beforeAll(async () => {
      recheckOwnerCookie = await loginAs(app, '09171110020');
      const created = await createApprovedSalonWithService(
        app,
        recheckOwnerCookie,
        { name: 'Availability Recheck Salon', capacity: 2 },
        { price: 1_000_000 },
      );
      recheckSalonId = created.salonId;
      recheckServiceId = created.serviceId;
      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ bookingConfirmationMode: 'manual_approval' })
        .expect(200);

      const w1 = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', recheckOwnerCookie)
        .send({ name: 'Recheck Worker 1', phone: '09171110021' })
        .expect(201);
      worker1Id = w1.body.id;
      const w2 = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', recheckOwnerCookie)
        .send({ name: 'Recheck Worker 2', phone: '09171110022' })
        .expect(201);
      worker2Id = w2.body.id;
    });

    function recheckBook(startsAt: string, cookie: string, extra: Record<string, unknown> = {}) {
      return request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', cookie)
        .send({ salonId: recheckSalonId, serviceId: recheckServiceId, startsAt, ...extra });
    }

    async function recheckStatusOf(id: string): Promise<string> {
      const [row] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [id]);
      return row.status;
    }

    // 1. approval succeeds when availability is still valid ---------------------------
    it('approves normally when nothing about availability has changed since the request', async () => {
      const cust = await loginAs(app, '09171110023');
      const created = await recheckBook(futureIso(300), cust).expect(201);
      const bookingId = created.body.booking.id;

      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(200);

      expect(res.body.status).toBe('pending_payment');
    });

    // 2. approval fails when capacity becomes insufficient -----------------------------
    it('auto-expires the request (never opening a payment window) when the salon lowered its own capacity below what is already pending', async () => {
      const startsAt = futureIso(301);
      const custA = await loginAs(app, '09171110024');
      const custB = await loginAs(app, '09171110025');
      // Capacity 2 lets both pending_approval requests coexist for the same slot -- exactly
      // the same rule that already blocks a THIRD, over-capacity request at creation time.
      const bookingA = await recheckBook(startsAt, custA).expect(201);
      const bookingB = await recheckBook(startsAt, custB).expect(201);
      const [paymentsBefore] = await Promise.all([
        ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingA.body.booking.id]),
      ]);
      expect(paymentsBefore).toHaveLength(0);

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 1 })
        .expect(200);

      // Neither request can be approved in isolation any more -- approving A while B is
      // still pending would leave 2 slot-blocking bookings against a capacity of 1.
      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingA.body.booking.id}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(409);
      expect(res.body.code).toBe(BOOKING_UNAVAILABLE);

      // Auto-expired, not left dangling in pending_approval for the next cron tick --
      // the outcome cannot change before then, so there's nothing to wait for.
      expect(await recheckStatusOf(bookingA.body.booking.id)).toBe('expired');
      const paymentsAfter = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [
        bookingA.body.booking.id,
      ]);
      expect(paymentsAfter).toHaveLength(0);

      // With A now expired (no longer a blocking status), B's own overlap count excluding
      // itself drops to 0 -- capacity 1 is enough for B alone, so it CAN now be approved.
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingB.body.booking.id}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(200);
      expect(await recheckStatusOf(bookingB.body.booking.id)).toBe('pending_payment');

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 2 })
        .expect(200);
    });

    // 3. approval fails when worker availability becomes invalid -----------------------
    it('auto-expires the request when the requested worker was deactivated after the request was made', async () => {
      const cust = await loginAs(app, '09171110026');
      const created = await recheckBook(futureIso(302), cust, { workerId: worker1Id }).expect(201);
      const bookingId = created.body.booking.id;

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(409);
      expect(res.body.code).toBe(WORKER_UNAVAILABLE);
      expect(await recheckStatusOf(bookingId)).toBe('expired');

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: true })
        .expect(200);
    });

    it('auto-expires the request when the requested worker was reassigned away from the service after the request was made', async () => {
      const cust = await loginAs(app, '09171110027');
      const created = await recheckBook(futureIso(303), cust, { workerId: worker2Id }).expect(201);
      const bookingId = created.body.booking.id;

      // worker2 starts unrestricted (no worker_services rows -> eligible for everything
      // per the opt-out model). Giving it exactly one row, for a DIFFERENT service, makes
      // it ineligible for the one this request actually asked for.
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      const otherService = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', recheckOwnerCookie)
        .send({ categoryId: categoriesRes.body[0].id, name: 'Other Service', price: 500_000, durationMin: 30 })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker2Id}/services`)
        .set('Cookie', recheckOwnerCookie)
        .send({ serviceIds: [otherService.body.id] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(409);
      expect(res.body.code).toBe(WORKER_UNAVAILABLE);
      expect(await recheckStatusOf(bookingId)).toBe('expired');

      // Restore worker2 to unrestricted for any later case in this block.
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker2Id}/services`)
        .set('Cookie', recheckOwnerCookie)
        .send({ serviceIds: [] })
        .expect(200);
    });

    // The failed re-check is auditable exactly like every other transition here, and
    // distinguishable in the timeline from a genuine timeout.
    it('records the availability-recheck failure as a distinct, attributable event', async () => {
      const cust = await loginAs(app, '09171110028');
      const created = await recheckBook(futureIso(304), cust, { workerId: worker1Id }).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: false })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', recheckOwnerCookie)
        .expect(409);

      const events = await request(app.getHttpServer())
        .get(`/api/admin/bookings/${bookingId}/events`)
        .set('Cookie', adminCookie)
        .expect(200);
      const approvalExpired = events.body.find((e: { eventType: string }) => e.eventType === 'APPROVAL_EXPIRED');
      expect(approvalExpired.metadata.cause).toBe('availability_recheck_failed');
      expect(approvalExpired.metadata.reasonCode).toBe(WORKER_UNAVAILABLE);
      expect(approvalExpired.actorType).toBe('system');
      const released = events.body.find(
        (e: { eventType: string; metadata: { cause: string } }) =>
          e.eventType === 'SLOT_RELEASED' && e.metadata?.cause === 'availability_recheck_failed',
      );
      expect(released).toBeTruthy();

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: true })
        .expect(200);
    });

    // The customer is told the truth: the salon DID respond, the slot changed underneath
    // the request -- never the "the salon didn't respond in time" timeout copy, which
    // would misdirect a support conversation here.
    it('tells the customer the truth instead of the timeout copy', async () => {
      const cust = await loginAs(app, '09171110029');
      const created = await recheckBook(futureIso(305), cust, { workerId: worker1Id }).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: false })
        .expect(200);

      const sms = captureSms();
      try {
        await request(app.getHttpServer())
          .post(`/api/salons/mine/bookings/${bookingId}/approve`)
          .set('Cookie', recheckOwnerCookie)
          .expect(409);
      } finally {
        sms.restore();
      }

      expect(sms.lines.some((l) => l.includes('09171110029') && l.includes('دیگر در دسترس نیست'))).toBe(true);
      expect(sms.lines.some((l) => l.includes('09171110029') && l.includes('عدم پاسخ سالن'))).toBe(false);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}`)
        .set('Cookie', recheckOwnerCookie)
        .send({ active: true })
        .expect(200);
    });

    // 4. concurrent approval attempts cannot double-book --------------------------------
    // Two pending_approval requests can only ever contend for the SAME reduced capacity
    // via the capacity axis, never the worker axis: two overlapping requests for the same
    // specific worker are already impossible to create (createHold's own worker-overlap
    // check, run against SLOT_BLOCKING_STATUSES, rejects the second one at REQUEST time).
    // So capacity is the only real fixture for this scenario.
    it('never lets two concurrently-approved, over-capacity requests both succeed', async () => {
      const startsAt = futureIso(306);
      const custA = await loginAs(app, '09171110030');
      const custB = await loginAs(app, '09171110031');
      const bookingA = await recheckBook(startsAt, custA).expect(201);
      const bookingB = await recheckBook(startsAt, custB).expect(201);

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 1 })
        .expect(200);

      const results = await Promise.all(
        [bookingA.body.booking.id, bookingB.body.booking.id].map((id) =>
          request(app.getHttpServer())
            .post(`/api/salons/mine/bookings/${id}/approve`)
            .set('Cookie', recheckOwnerCookie),
        ),
      );
      const statuses = [
        await recheckStatusOf(bookingA.body.booking.id),
        await recheckStatusOf(bookingB.body.booking.id),
      ];
      // The decisive invariant: AT MOST one request may ever reach a payable state, and
      // when one does, the redis-lock/CAS pair around approve() must have prevented the
      // other from reaching it too -- that is what "cannot double-book" actually means.
      //
      // A genuinely simultaneous race over two requests that TOGETHER exceed capacity can
      // legitimately produce a winner-less outcome too: whichever request's re-check runs
      // first still finds the OTHER one sitting in pending_approval (nothing has resolved
      // it yet), which by itself already fills the reduced capacity -- so it can correctly
      // self-expire, and the second request either loses the redis lock outright (stays
      // pending_approval, a clean retryable 409) or runs its own re-check moments later and
      // finds nothing changed. Zero winners here is a safe, honest report of "neither could
      // be honoured given what was true at that instant" -- not a bug. What a real owner
      // sees in this situation is two 409s and can approve whichever one is still pending
      // next; that path is exactly the SEQUENTIAL case the previous test proves works. The
      // one outcome that must be structurally impossible is BOTH ending up pending_payment.
      const succeeded = statuses.filter((s) => s === 'pending_payment').length;
      expect(succeeded).toBeLessThanOrEqual(1);
      const okResults = results.filter((r) => r.status === 200).length;
      expect(okResults).toBe(succeeded);
      // No double-booking: never more than one Payment row for this pair of requests.
      const payments = await ds.query(
        `SELECT id FROM payments WHERE booking_id = ANY($1::uuid[])`,
        [[bookingA.body.booking.id, bookingB.body.booking.id]],
      );
      expect(payments.length).toBeLessThanOrEqual(1);
      expect(payments.length).toBe(succeeded);

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 2 })
        .expect(200);

      // Whatever this race left behind, the salon must still be able to reach a clean
      // resolution afterward -- a still-pending loser can be approved (or declined) next,
      // exactly like any other pending_approval request.
      for (const id of [bookingA.body.booking.id, bookingB.body.booking.id]) {
        if (await recheckStatusOf(id) === 'pending_approval') {
          await request(app.getHttpServer())
            .post(`/api/salons/mine/bookings/${id}/reject`)
            .set('Cookie', recheckOwnerCookie)
            .send({ reason: 'cleanup' })
            .expect(200);
        }
      }
    });

    // 10. automatic-mode bookings are entirely unaffected by any of the above -----------
    it('never runs the availability re-check for automatic-mode bookings, which have no approve() step at all', async () => {
      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ bookingConfirmationMode: 'automatic' })
        .expect(200);

      // Lower capacity to 1 first -- if approve()'s re-check somehow ran against an
      // automatic booking, this would be exactly the condition that trips it.
      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 1 })
        .expect(200);

      const cust = await loginAs(app, '09171110032');
      const created = await recheckBook(futureIso(307), cust).expect(201);
      // Automatic mode goes straight to pending_payment -- no approve() call exists on
      // this path for the re-check to run inside.
      expect(created.body.booking.status).toBe('pending_payment');
      expect(created.body.booking.confirmationMode).toBe('automatic');

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', recheckOwnerCookie)
        .send({ capacity: 2, bookingConfirmationMode: 'manual_approval' })
        .expect(200);
    });
  });

  // --- Scenario 4 & 5: the two expiry jobs -------------------------------------------
  describe('expiry', () => {
    beforeAll(() => setMode('manual_approval'));

    it('expires a request the salon never answered, releases the slot, and never owes a refund', async () => {
      const startsAt = futureIso(220);
      const created = await book(startsAt).expect(201);
      const bookingId = created.body.booking.id;

      await ds.query(`UPDATE bookings SET approval_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);
      const expired = await app.get(BookingApprovalExpiryJob).run();
      expect(expired).toBeGreaterThanOrEqual(1);

      expect(await statusOf(bookingId)).toBe('expired');
      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(0);

      const other = await loginAs(app, '09171110007');
      await book(startsAt, other).expect(201);
    });

    it('never expires a request whose deadline has not arrived', async () => {
      const created = await book(futureIso(221)).expect(201);
      const bookingId = created.body.booking.id;

      await app.get(BookingApprovalExpiryJob).run();

      expect(await statusOf(bookingId)).toBe('pending_approval');
    });

    it('is idempotent -- a second run does not re-touch an already-expired request', async () => {
      const created = await book(futureIso(222)).expect(201);
      const bookingId = created.body.booking.id;
      await ds.query(`UPDATE bookings SET approval_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);

      await app.get(BookingApprovalExpiryJob).run();
      const before = await statusOf(bookingId);
      await app.get(BookingApprovalExpiryJob).run();

      expect(before).toBe('expired');
      expect(await statusOf(bookingId)).toBe('expired');
    });

    it('never overrides a real human decision made before the tick', async () => {
      const created = await book(futureIso(223)).expect(201);
      const bookingId = created.body.booking.id;
      // The deadline has passed, but the salon got their answer in first.
      await ds.query(`UPDATE bookings SET approval_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      await app.get(BookingApprovalExpiryJob).run();

      // The approval stands: the job's WHERE status='pending_approval' excluded it.
      expect(await statusOf(bookingId)).toBe('pending_payment');
    });

    it('expires an approved-but-unpaid booking on its own snapshotted payment deadline', async () => {
      const created = await book(futureIso(224)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      // created_at is only seconds old, so this ONLY expires if the snapshot column is
      // what the job actually reads.
      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);
      await app.get(BookingExpiryJob).run();

      expect(await statusOf(bookingId)).toBe('expired');
    });

    // Scenario 6. The pre-existing "late capture on a dead booking" path already covers
    // this: the money is captured, the booking CAS loses, and the payment is queued for
    // refund rather than resurrecting an expired booking into a slot someone else may hold.
    it('a payment that lands AFTER the window closed never resurrects the booking -- it queues a refund', async () => {
      const created = await book(futureIso(225)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      const retry = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);
      const authority = new URL(retry.body.paymentUrl).searchParams.get('Authority')!;

      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);
      await app.get(BookingExpiryJob).run();
      expect(await statusOf(bookingId)).toBe('expired');

      // The customer pays through their still-open Zarinpal tab.
      await request(app.getHttpServer())
        .get('/api/payments/callback')
        .query({ Authority: authority, Status: 'OK' })
        .expect(302);

      expect(await statusOf(bookingId)).toBe('expired');
      const [payment] = await ds.query(`SELECT status FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payment.status).toBe('refund_pending');
    });
  });

  // --- Regressions found by the adversarial review -------------------------------------
  describe('regressions', () => {
    beforeAll(() => setMode('manual_approval'));

    it('refuses to approve a request whose appointment time has already passed', async () => {
      const created = await book(futureIso(280)).expect(201);
      const bookingId = created.body.booking.id;
      // A request can outlive the slot it asked for: its approval deadline is independent
      // of the booking's own start.
      await ds.query(`UPDATE bookings SET starts_at = now() - interval '1 hour', ends_at = now() WHERE id = $1`, [
        bookingId,
      ]);

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(409);
      expect(await statusOf(bookingId)).toBe('pending_approval');
    });

    it('makes the owner decline through reject(), not the customer cancel route', async () => {
      const created = await book(futureIso(281)).expect(201);
      const bookingId = created.body.booking.id;

      // cancel() would record cancelled_by_salon ("a real appointment was called off,
      // refund the customer"), send the wrong SMS, and skip the mandatory reason.
      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', ownerCookie)
        .expect(400);
      expect(await statusOf(bookingId)).toBe('pending_approval');

      // The customer's own withdrawal path is unaffected.
      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', customerCookie)
        .expect(200);
      expect(await statusOf(bookingId)).toBe('cancelled_by_user');
    });

    it('refuses to mint a fresh gateway session once the payment deadline has passed', async () => {
      const created = await book(futureIso(282)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      // The status lags the deadline by up to one cron tick; retry-payment must not hand
      // out a live payment link in that window.
      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);
      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(409);
    });

    it('rejects a whitespace-only rejection reason instead of texting the customer a blank one', async () => {
      const created = await book(futureIso(283)).expect(201);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${created.body.booking.id}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: '    ' })
        .expect(400);
    });

    it('bounds the GLOBAL approval timeout exactly like its per-salon twin', async () => {
      for (const value of [0, 1441]) {
        await request(app.getHttpServer())
          .patch('/api/admin/config')
          .set('Cookie', adminCookie)
          .send({ updates: [{ key: 'booking_approval_timeout_minutes', value }] })
          .expect(400);
      }
    });

    // The critical one. STALE_AFTER_MINUTES (20) used to be safe only because the payment
    // window was globally 15 minutes, so reconciliation never met a live booking. A
    // per-salon window longer than 20 minutes breaks that coincidence, and an unpaid but
    // perfectly valid booking would be cancelled mid-window.
    it('reconciliation leaves a booking alone while its own payment window is still open', async () => {
      await setMode('automatic');
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ paymentTimeoutMinutes: 120 })
        .expect(200);

      const created = await book(futureIso(284)).expect(201);
      const bookingId = created.body.booking.id;

      // Old enough for the 20-minute staleness clock, but ~100 minutes of the customer's
      // window still remain.
      await ds.query(
        `UPDATE payments SET created_at = now() - interval '21 minutes' WHERE booking_id = $1`,
        [bookingId],
      );

      await app.get(PaymentReconciliationJob).run();

      // Decisive either way: the mock gateway verifies every authority successfully, so a
      // booking that WAS selected would come back 'confirmed'. Untouched is the only
      // outcome consistent with "not selected".
      expect(await statusOf(bookingId)).toBe('pending_payment');

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ paymentTimeoutMinutes: null })
        .expect(200);
      await setMode('manual_approval');
    });

    // approve() opens the payment window and inserts the Payment row; a customer who never
    // clicks "pay" leaves it with no authority. Nothing else ever revisits an `initiated`
    // payment, so before this these accumulated forever and crowded out the 200-row batch.
    it('retires an approved-but-never-paid payment that never got a gateway session', async () => {
      const created = await book(futureIso(285)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      const [fresh] = await ds.query(`SELECT authority FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(fresh.authority).toBeNull();

      await ds.query(
        `UPDATE payments SET created_at = now() - interval '21 minutes' WHERE booking_id = $1`,
        [bookingId],
      );
      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);

      await app.get(PaymentReconciliationJob).run();

      const [payment] = await ds.query(`SELECT status FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payment.status).toBe('failed');
    });
  });

  // --- SMS budget: the payment-expiry notification is manual-mode ONLY -----------------
  describe('SMS is spent deliberately', () => {
    it('does NOT text a customer whose AUTOMATIC checkout was simply abandoned', async () => {
      await setMode('automatic');
      // A dedicated customer, and the assertion is scoped to THEIR phone: one run of the
      // job expires every booking that is due, including manual-mode leftovers from
      // earlier cases in this file which legitimately DO get texted. A bare "no such SMS
      // anywhere" assertion would fail for the wrong reason.
      const abandonCookie = await loginAs(app, '09171110009');
      const created = await book(futureIso(290), abandonCookie).expect(201);
      const bookingId = created.body.booking.id;
      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);

      const sms = captureSms();
      try {
        await app.get(BookingExpiryJob).run();
      } finally {
        sms.restore();
      }

      expect(await statusOf(bookingId)).toBe('expired');
      // An abandoned automatic checkout is someone who walked away from the payment page
      // seconds ago and already knows they didn't pay. Texting them spends real money to
      // say nothing.
      expect(sms.lines.some((l) => l.includes('09171110009') && l.includes('مهلت پرداخت'))).toBe(false);
    });

    it('DOES text a customer whose approved manual booking lost its payment window', async () => {
      await setMode('manual_approval');
      const created = await book(futureIso(291)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      await ds.query(`UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [
        bookingId,
      ]);

      const sms = captureSms();
      try {
        await app.get(BookingExpiryJob).run();
      } finally {
        sms.restore();
      }

      expect(await statusOf(bookingId)).toBe('expired');
      // The opposite case: this customer was told "the salon accepted, pay by HH:MM" and
      // then went about their day. Letting that close silently costs them the slot.
      expect(sms.lines.some((l) => l.includes('مهلت پرداخت'))).toBe(true);
    });

    it('does not text the customer merely for submitting a request -- they are on the screen', async () => {
      await setMode('manual_approval');

      const sms = captureSms();
      try {
        await book(futureIso(292)).expect(201);
        // notifyApprovalRequested is awaited inside createHold, so it has already run.
      } finally {
        sms.restore();
      }

      // The OWNER must still be texted: they aren't looking at the app and have only the
      // approval window to act.
      expect(sms.lines.some((l) => l.includes('درخواست نوبت جدید'))).toBe(true);
      expect(sms.lines.some((l) => l.includes('درخواست نوبت شما'))).toBe(false);
    });

    // 6. no provider reminder is sent before timeout -------------------------------------
    // A deliberate product decision, not a gap: the 10-minute window is short enough that
    // a second SMS would be spending money to repeat something the owner was already told
    // once. See docs/technical-overview/28's "Deliberate cuts" section.
    it('sends exactly ONE owner SMS across the full pending window, with no reminder before the approval deadline', async () => {
      await setMode('manual_approval');
      const ownerPhone = '09171110001';
      const custCookie = await loginAs(app, '09171110033');

      const sms = captureSms();
      let bookingId: string;
      try {
        const created = await book(futureIso(293), custCookie).expect(201);
        bookingId = created.body.booking.id;
        // Simulate the request having sat pending for its entire window with the owner
        // never acting -- if a reminder job existed, this is exactly the gap it would
        // fire into.
        await ds.query(`UPDATE bookings SET approval_expires_at = now() - interval '1 minute' WHERE id = $1`, [
          bookingId,
        ]);
        await app.get(BookingApprovalExpiryJob).run();
      } finally {
        sms.restore();
      }

      const ownerLines = sms.lines.filter((l) => l.includes(ownerPhone));
      // Exactly the one initial "a new request is waiting" ping -- never a second,
      // reminder-shaped message before (or instead of) the timeout.
      expect(ownerLines).toHaveLength(1);
      expect(ownerLines[0]).toContain('درخواست نوبت جدید');
    });
  });

  // --- Scenario 8: config snapshotting ------------------------------------------------
  describe('deadline snapshotting', () => {
    beforeAll(() => setMode('manual_approval'));

    it('does not move an in-flight request when an admin later changes the global timeout', async () => {
      const created = await book(futureIso(230)).expect(201);
      const bookingId = created.body.booking.id;
      const [before] = await ds.query(`SELECT approval_expires_at FROM bookings WHERE id = $1`, [bookingId]);

      await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Cookie', adminCookie)
        .send({ updates: [{ key: 'booking_approval_timeout_minutes', value: 600 }] })
        .expect(200);

      const [after] = await ds.query(`SELECT approval_expires_at FROM bookings WHERE id = $1`, [bookingId]);
      expect(new Date(after.approval_expires_at).getTime()).toBe(new Date(before.approval_expires_at).getTime());

      // Restore the real seeded default (10), so later cases in this file aren't running
      // against a 10-hour window.
      await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Cookie', adminCookie)
        .send({ updates: [{ key: 'booking_approval_timeout_minutes', value: 10 }] })
        .expect(200);
    });

    it('resolves the platform default to exactly 10 minutes for a request with no salon override', async () => {
      // Offset kept well clear of this describe block's other cases (230, 231): with an
      // exactly-60-minute service duration, an offset only 1 hour from an ALREADY-COMPUTED
      // neighbour is one real wall-clock millisecond away from a genuine overlap, since
      // each futureIso() call reads Date.now() at a slightly later real instant than the
      // last. This is exactly the race that briefly broke 'applies the per-salon admin
      // override...' below when this case was first inserted at offset 232.
      const created = await book(futureIso(234)).expect(201);
      const elapsedMinutes = (new Date(created.body.booking.approvalExpiresAt).getTime() - Date.now()) / 60_000;
      // Deliberately short -- see BookingSettingsService/platform_config seed: a customer
      // should not sit on an unpayable slot for half an hour waiting on an owner who may
      // not be looking at their phone.
      expect(elapsedMinutes).toBeGreaterThan(9.5);
      expect(elapsedMinutes).toBeLessThanOrEqual(10);
    });

    it('applies the per-salon admin override to newly created requests', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: 120 })
        .expect(200);

      const created = await book(futureIso(231)).expect(201);
      const elapsedMinutes =
        (new Date(created.body.booking.approvalExpiresAt).getTime() - Date.now()) / 60_000;
      // ~120, allowing for request latency.
      expect(elapsedMinutes).toBeGreaterThan(115);
      expect(elapsedMinutes).toBeLessThanOrEqual(121);

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: null })
        .expect(200);
    });
  });

  // --- Scenarios 9 & 10: mode changes mid-flight --------------------------------------
  describe('salon mode changes never rewrite bookings already in flight', () => {
    it('leaves an existing pending_approval request on the manual workflow after switching to automatic', async () => {
      await setMode('manual_approval');
      const created = await book(futureIso(240)).expect(201);
      const bookingId = created.body.booking.id;

      await setMode('automatic');

      const [row] = await ds.query(`SELECT status, confirmation_mode FROM bookings WHERE id = $1`, [bookingId]);
      expect(row.status).toBe('pending_approval');
      expect(row.confirmation_mode).toBe('manual_approval');
      // Still resolvable through the manual routes, because that is the workflow it was born under.
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
    });

    it('leaves an existing automatic booking alone after switching to manual', async () => {
      await setMode('automatic');
      const created = await book(futureIso(241)).expect(201);
      const bookingId = created.body.booking.id;
      expect(created.body.booking.status).toBe('pending_payment');

      await setMode('manual_approval');

      const [row] = await ds.query(`SELECT status, confirmation_mode FROM bookings WHERE id = $1`, [bookingId]);
      expect(row.status).toBe('pending_payment');
      expect(row.confirmation_mode).toBe('automatic');
    });
  });

  // --- Scenario 11: suspension --------------------------------------------------------
  describe('a suspended salon cannot take on new committed work', () => {
    it('refuses to approve a pending request while the salon is suspended', async () => {
      await setMode('manual_approval');
      const created = await book(futureIso(250)).expect(201);
      const bookingId = created.body.booking.id;

      await ds.query(`UPDATE salons SET status = 'suspended' WHERE id = $1`, [salonId]);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(409);
      expect(await statusOf(bookingId)).toBe('pending_approval');

      // Declining is still allowed -- it frees the customer rather than committing them.
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'سالن موقتا تعطیل است' })
        .expect(200);

      await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    });
  });

  // --- Scenario 13: coupons ------------------------------------------------------------
  describe('a rejected request never permanently consumes what the customer staked', () => {
    it('gives the coupon code back so it can be used on a later booking', async () => {
      await setMode('manual_approval');
      const couponUser = await loginAs(app, '09171110008');
      await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'APPROVE10', discountPercent: 10 })
        .expect(201);

      const created = await book(futureIso(260), couponUser, { couponCode: 'APPROVE10' }).expect(201);
      const bookingId = created.body.booking.id;
      expect(created.body.couponApplied).toBe(true);

      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/reject`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'not available' })
        .expect(200);

      // The redemption row is gone (releaseBookingHold), so the same customer can use the
      // code again -- a salon ignoring or declining a request must not burn it for life.
      const redemptions = await ds.query(`SELECT id FROM coupon_redemptions WHERE booking_id = $1`, [bookingId]);
      expect(redemptions).toHaveLength(0);

      const second = await book(futureIso(261), couponUser, { couponCode: 'APPROVE10' }).expect(201);
      expect(second.body.couponApplied).toBe(true);
    });
  });

  // --- The lifecycle log ----------------------------------------------------------------
  describe('booking lifecycle events', () => {
    it('records a reconstructable timeline an admin can read back', async () => {
      await setMode('manual_approval');
      const created = await book(futureIso(270)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/admin/bookings/${bookingId}/events`)
        .set('Cookie', adminCookie)
        .expect(200);

      const types = res.body.map((e: { eventType: string }) => e.eventType);
      expect(types).toEqual([
        'BOOKING_CREATED',
        'APPROVAL_REQUESTED',
        'SALON_APPROVED',
        'PAYMENT_WINDOW_STARTED',
      ]);
      const approved = res.body.find((e: { eventType: string }) => e.eventType === 'SALON_APPROVED');
      expect(approved.actorType).toBe('salon_owner');
      expect(approved.actorId).toBeTruthy();
    });

    // The timeline previously stopped at PAYMENT_WINDOW_STARTED and never recorded that
    // the booking was confirmed at all -- which is exactly the question the support view
    // exists to answer.
    it('records the payment and confirmation too, so a paid booking has a complete timeline', async () => {
      await setMode('manual_approval');
      const created = await book(futureIso(272)).expect(201);
      const bookingId = created.body.booking.id;
      await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      const retry = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/retry-payment`)
        .set('Cookie', customerCookie)
        .expect(200);
      const authority = new URL(retry.body.paymentUrl).searchParams.get('Authority')!;
      await request(app.getHttpServer())
        .get('/api/payments/callback')
        .query({ Authority: authority, Status: 'OK' })
        .expect(302);

      const res = await request(app.getHttpServer())
        .get(`/api/admin/bookings/${bookingId}/events`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.map((e: { eventType: string }) => e.eventType)).toEqual([
        'BOOKING_CREATED',
        'APPROVAL_REQUESTED',
        'SALON_APPROVED',
        'PAYMENT_WINDOW_STARTED',
        'PAYMENT_INITIATED',
        'PAYMENT_SUCCEEDED',
        'BOOKING_CONFIRMED',
      ]);
    });

    // Deliberately against an id that doesn't exist: the role guard must reject before the
    // handler ever looks anything up, so a non-admin can't even probe whether a booking
    // exists. Also keeps this case from competing for a slot with its neighbours.
    it('is admin-only', () =>
      request(app.getHttpServer())
        .get('/api/admin/bookings/00000000-0000-0000-0000-000000000000/events')
        .set('Cookie', customerCookie)
        .expect(403));
  });

  // --- Admin settings surface ------------------------------------------------------------
  describe('admin booking settings', () => {
    it('reports effective values with their provenance, and clears an override back to global', async () => {
      const base = await request(app.getHttpServer())
        .get(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(base.body.approvalTimeoutIsOverridden).toBe(false);
      expect(base.body.approvalTimeoutMinutes).toBe(base.body.globalApprovalTimeoutMinutes);

      const set = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: 45, paymentTimeoutMinutes: 25 })
        .expect(200);
      expect(set.body.approvalTimeoutMinutes).toBe(45);
      expect(set.body.approvalTimeoutOverride).toBe(45);
      expect(set.body.approvalTimeoutIsOverridden).toBe(true);

      const cleared = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: null })
        .expect(200);
      expect(cleared.body.approvalTimeoutOverride).toBeNull();
      expect(cleared.body.approvalTimeoutIsOverridden).toBe(false);
      expect(cleared.body.approvalTimeoutMinutes).toBe(cleared.body.globalApprovalTimeoutMinutes);
      // The untouched sibling override survived a single-field PATCH.
      expect(cleared.body.paymentTimeoutOverride).toBe(25);

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ paymentTimeoutMinutes: null })
        .expect(200);
    });

    it('rejects out-of-range timeouts at the DTO boundary', async () => {
      for (const value of [0, -5, 1441]) {
        await request(app.getHttpServer())
          .patch(`/api/admin/salons/${salonId}/booking-settings`)
          .set('Cookie', adminCookie)
          .send({ approvalTimeoutMinutes: value })
          .expect(400);
      }
    });

    it('is closed to non-admins, and the provider route cannot set timing values', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', ownerCookie)
        .send({ approvalTimeoutMinutes: 999 })
        .expect(403);

      // The provider's own route whitelists bookingConfirmationMode only -- a timing field
      // smuggled into it must never reach the column.
      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', ownerCookie)
        .send({ approvalTimeoutMinutes: 999, paymentTimeoutMinutes: 999 })
        .expect(200);
      const [row] = await ds.query(
        `SELECT approval_timeout_minutes, payment_timeout_minutes FROM salons WHERE id = $1`,
        [salonId],
      );
      expect(row.approval_timeout_minutes).toBeNull();
      expect(row.payment_timeout_minutes).toBeNull();
    });

    it('writes an audit row for a timeout change', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: 90 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/admin/audit-log')
        .set('Cookie', adminCookie)
        .query({ action: 'booking-settings.update' })
        .expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/booking-settings`)
        .set('Cookie', adminCookie)
        .send({ approvalTimeoutMinutes: null })
        .expect(200);
    });
  });
});
