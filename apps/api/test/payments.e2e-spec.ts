import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BookingExpiryJob } from '../src/booking/booking-expiry.job';
import { PushService } from '../src/push/push.service';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Payments — callback (e2e)', () => {
  let app: INestApplication;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let customerId: string;
  let ownerId: string;

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();

    const ownerCookie = await loginAs(app, '09129990005');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Payments Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
      categoryIds: [categoryId],
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09121010006');

    const ownerRow = await ds.query(`SELECT id FROM users WHERE phone = $1`, ['09129990005']);
    ownerId = ownerRow[0].id;
    const customerRow = await ds.query(`SELECT id FROM users WHERE phone = $1`, ['09121010006']);
    customerId = customerRow[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  function extractAuthority(paymentUrl: string): string {
    return new URL(paymentUrl).searchParams.get('Authority')!;
  }

  it('confirms the booking and marks the payment paid on a successful callback', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);
    expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=success&bookingId=${created.body.booking.id}`);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');
  });

  it('sends a push notification to the customer and salon owner on confirmation, alongside SMS', async () => {
    const pushService = app.get(PushService);
    const sendToUserSpy = jest.spyOn(pushService, 'sendToUser');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(36) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    await request(app.getHttpServer())
      .get(`/api/payments/callback?Authority=${authority}&Status=OK`)
      .expect(302);

    expect(sendToUserSpy).toHaveBeenCalledWith(customerId, expect.objectContaining({ title: expect.any(String) }));
    expect(sendToUserSpy).toHaveBeenCalledWith(ownerId, expect.objectContaining({ title: expect.any(String) }));
  });

  it('is idempotent — calling the callback again on an already-paid booking redirects with success, not an error', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(48) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    const second = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);
    expect(second.headers.location).toBe(`http://localhost:3003/booking/callback?status=success&bookingId=${created.body.booking.id}`);
  });

  // The idempotency test above is sequential (await-then-await), which only proves
  // resolveByAuthority's status check works once the first call has fully committed.
  // The real risk this module documents (see handleCallback's own comment on the
  // conditional-UPDATE capture transaction) is a genuinely concurrent double-delivery --
  // a back-button + refresh or an in-app browser retry landing while the first call's
  // gateway verify round-trip is still in flight. This fires two real concurrent
  // callbacks for the same authority and proves the conditional UPDATE (not a mocked
  // "lost CAS" like payments.service.spec.ts) actually serializes them: the booking is
  // confirmed exactly once and the customer is notified exactly once, regardless of
  // which request happens to win.
  it('concurrency: two simultaneous callbacks for the same authority -- confirmed exactly once, notified exactly once', async () => {
    const pushService = app.get(PushService);
    const sendToUserSpy = jest.spyOn(pushService, 'sendToUser');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(220) })
      .expect(201);
    const bookingId = created.body.booking.id;
    const authority = extractAuthority(created.body.paymentUrl);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }),
      request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }),
    ]);

    // Both requests must redirect to the SAME success page -- a customer who genuinely
    // double-delivers the callback must see identical, successful results either way,
    // not one success and one error.
    const successLocation = `http://localhost:3003/booking/callback?status=success&bookingId=${bookingId}`;
    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(first.headers.location).toBe(successLocation);
    expect(second.headers.location).toBe(successLocation);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${bookingId}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');

    const ds = app.get(DataSource);
    const [payment] = await ds.query(`SELECT status FROM payments WHERE booking_id = $1`, [bookingId]);
    expect(payment.status).toBe('paid');

    // Exactly one customer "booking confirmed" push for this booking -- the winner's
    // notifyConfirmed call, never the loser's (it sees affected=0 on the conditional
    // UPDATE and skips notifying entirely).
    const confirmationCalls = sendToUserSpy.mock.calls.filter(
      ([userId, data]) => userId === customerId && (data as { data?: { bookingId?: string } }).data?.bookingId === bookingId,
    );
    expect(confirmationCalls).toHaveLength(1);
  });

  it('cancels the booking when Zarinpal reports Status=NOK', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'NOK' })
      .expect(302);
    expect(res.headers.location).toBe(
      `http://localhost:3003/booking/callback?status=failed&code=PAYMENT_FAILED&bookingId=${created.body.booking.id}`,
    );

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('cancelled_by_user');
  });

  // Previously asserted a raw 404. That response reached the CUSTOMER's browser, arriving
  // straight from the bank and quite possibly after a real deduction; the unresolvable
  // authority is now reported to operators as money-critical instead, and the customer
  // gets the normal failure page (no bookingId, which that page already handles).
  it('redirects an unresolvable authority to the failure page instead of 404ing at the customer', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: 'MOCK-doesnotexist', Status: 'OK' })
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:3003/booking/callback?status=failed');
  });

  it('does not resurrect an expired booking on a late callback -- it refunds the capture', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(144) })
      .expect(201);
    const bookingId = created.body.booking.id;
    const authority = extractAuthority(created.body.paymentUrl);

    // Age the hold past the TTL and let BookingExpiryJob release the slot -- it flips the
    // booking to 'expired' but deliberately leaves the payment 'initiated'.
    const ds = app.get(DataSource);
    // Ageing a hold now means shifting its own snapshotted deadline too, not just
    // created_at: a booking created today carries payment_expires_at, and THAT is what
    // the job reads (created_at is only the fallback for rows predating that column).
    // Shifting both by the same interval is the honest simulation of "this hold is
    // 20 minutes old".
    await ds.query(
      `UPDATE bookings
          SET created_at = now() - interval '20 minutes',
              payment_expires_at = payment_expires_at - interval '20 minutes'
        WHERE id = $1`,
      [bookingId],
    );
    expect(await app.get(BookingExpiryJob).run()).toBeGreaterThanOrEqual(1);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);
    // 'refunding', not 'failed': the money WAS captured and a refund is queued, so the
    // failure page ("no payment happened, no booking exists") would tell the customer the
    // opposite of what their bank statement shows. 'failed' is now reserved for a genuine
    // decline where nothing was captured.
    expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=refunding&bookingId=${bookingId}`);

    const [booking] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(booking.status).toBe('expired'); // never re-confirmed into a released slot
    const [payment] = await ds.query(`SELECT status, ref_id, refund_requested_at FROM payments WHERE booking_id = $1`, [
      bookingId,
    ]);
    // The money Zarinpal captured is queued for a real refund (RefundRetryJob performs it),
    // exactly as the reconciliation path has always treated the same situation.
    expect(payment.status).toBe('refund_pending');
    expect(payment.ref_id).not.toBeNull();
    expect(payment.refund_requested_at).not.toBeNull();
  });

  it('recovers a capture that lands after the payment was already marked failed', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(168) })
      .expect(201);
    const bookingId = created.body.booking.id;
    const authority = extractAuthority(created.body.paymentUrl);

    // Exactly the state cancel() (pending_payment branch) and reconciliation's
    // verify-failed branch leave behind: booking cancelled, payment 'failed'. No job ever
    // revisits a 'failed' payment, so a callback dropping it was silent money loss.
    const ds = app.get(DataSource);
    await ds.query(`UPDATE bookings SET status = 'cancelled_by_user' WHERE id = $1`, [bookingId]);
    await ds.query(`UPDATE payments SET status = 'failed' WHERE booking_id = $1`, [bookingId]);

    const res = await request(app.getHttpServer())
      .get('/api/payments/callback')
      .query({ Authority: authority, Status: 'OK' })
      .expect(302);
    // Same as the expired-booking case above: captured money being sent back is 'refunding'.
    expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=refunding&bookingId=${bookingId}`);

    const [payment] = await ds.query(`SELECT status, refund_requested_at FROM payments WHERE booking_id = $1`, [bookingId]);
    expect(payment.status).toBe('refund_pending');
    expect(payment.refund_requested_at).not.toBeNull();
    const [booking] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(booking.status).toBe('cancelled_by_user'); // the dead booking stays dead
  });

  it('redirects to the frontend booking callback page on success', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(96) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);
    const bookingId = created.body.booking.id;

    const res = await request(app.getHttpServer())
      .get(`/api/payments/callback?Authority=${authority}&Status=OK`)
      .expect(302);
    expect(res.headers.location).toBe(`http://localhost:3003/booking/callback?status=success&bookingId=${bookingId}`);
  });

  it('redirects to the frontend booking callback page on failure', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(120) })
      .expect(201);
    const authority = extractAuthority(created.body.paymentUrl);
    const bookingId = created.body.booking.id;

    const res = await request(app.getHttpServer())
      .get(`/api/payments/callback?Authority=${authority}&Status=NOK`)
      .expect(302);
    expect(res.headers.location).toBe(
      `http://localhost:3003/booking/callback?status=failed&code=PAYMENT_FAILED&bookingId=${bookingId}`,
    );
  });
});
