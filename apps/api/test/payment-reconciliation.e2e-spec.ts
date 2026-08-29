import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';
import { PaymentReconciliationJob } from '../src/booking/payment-reconciliation.job';

describe('Payment reconciliation job (e2e)', () => {
  let app: INestApplication;
  let job: PaymentReconciliationJob;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    job = app.get(PaymentReconciliationJob);

    const ownerCookie = await loginAs(app, '09121110015');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reconciliation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 2,
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

    customerCookie = await loginAs(app, '09122220016');
  });

  afterAll(async () => {
    await app.close();
  });

  it('confirms a stale initiated payment that the mock gateway reports as successful', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE payments SET created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [created.body.booking.id],
    );
    // Age the booking's own payment window alongside the payment row. Reconciliation is
    // deadline-aware now: a payment is only "stale" once its booking genuinely can't be
    // paid for any more, so ageing created_at alone would leave a booking whose customer
    // still has time -- and correctly not select it.
    await ds.query(
      `UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.booking.id],
    );

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('confirmed');
  });

  it('cancels the booking when the mock gateway reports the payment as never having succeeded', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    // force MockPaymentGateway.verifyPayment to report failure by rewriting the authority
    // to start with the sentinel prefix it checks for. The job now re-verifies EVERY
    // authority ever issued for the payment (payment_authorities, not just the current
    // one), so the sentinel has to be applied to the ledger row too -- otherwise the
    // untouched original still verifies successfully and this booking is legitimately
    // confirmed rather than cancelled.
    await ds.query(
      `UPDATE payments SET authority = 'MOCK-FAIL-' || authority, created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [created.body.booking.id],
    );
    // Age the booking's own payment window alongside the payment row. Reconciliation is
    // deadline-aware now: a payment is only "stale" once its booking genuinely can't be
    // paid for any more, so ageing created_at alone would leave a booking whose customer
    // still has time -- and correctly not select it.
    await ds.query(
      `UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.booking.id],
    );
    await ds.query(
      `UPDATE payment_authorities pa SET authority = 'MOCK-FAIL-' || pa.authority
       FROM payments p WHERE p.id = pa.payment_id AND p.booking_id = $1`,
      [created.body.booking.id],
    );

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('cancelled_by_user');
  });

  it('confirms via a SUPERSEDED authority when the current one never succeeded', async () => {
    // retryPayment overwrites payments.authority while the customer's earlier Zarinpal
    // tab stays chargeable. Reconciling only the current authority would declare this a
    // failure and cancel the booking with the deposit still captured on the old session.
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 120 * 60 * 60_000).toISOString() })
      .expect(201);
    const bookingId = created.body.booking.id;
    const oldAuthority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/retry-payment`)
      .set('Cookie', customerCookie)
      .expect(200);

    const ds = app.get(DataSource);
    // Only the NEWEST session is made to fail -- the older one is the one that was paid.
    await ds.query(
      `UPDATE payment_authorities pa SET authority = 'MOCK-FAIL-' || pa.authority
       FROM payments p WHERE p.id = pa.payment_id AND p.booking_id = $1 AND pa.authority = p.authority`,
      [bookingId],
    );
    await ds.query(
      `UPDATE payments SET authority = 'MOCK-FAIL-' || authority, created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [bookingId],
    );
    // Age the booking's own payment window alongside the payment row. Reconciliation is
    // deadline-aware now: a payment is only "stale" once its booking genuinely can't be
    // paid for any more, so ageing created_at alone would leave a booking whose customer
    // still has time -- and correctly not select it.
    await ds.query(
      `UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [bookingId],
    );

    expect(await job.run()).toBe(1);

    const [payment] = await ds.query(`SELECT status, authority FROM payments WHERE booking_id = $1`, [bookingId]);
    expect(payment.status).toBe('paid');
    expect(payment.authority).toBe(oldAuthority); // the session that actually captured
    const [booking] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(booking.status).toBe('confirmed');
  });

  it('ignores payments that are not yet stale', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
      .expect(201);

    const reconciled = await job.run();
    expect(reconciled).toBe(0);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('pending_payment');
  });

  it('does not resurrect an already-expired booking; the captured payment is queued for automatic refund', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString() })
      .expect(201);

    const ds = app.get(DataSource);
    // Simulate BookingExpiryJob having already run -- its 15-minute TTL is shorter
    // than this job's 20-minute stale threshold, so this is the common production
    // case, not a rare race, whenever a callback genuinely never arrives.
    await ds.query(`UPDATE bookings SET status = 'expired' WHERE id = $1`, [created.body.booking.id]);
    await ds.query(
      `UPDATE payments SET created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
      [created.body.booking.id],
    );
    // Age the booking's own payment window alongside the payment row. Reconciliation is
    // deadline-aware now: a payment is only "stale" once its booking genuinely can't be
    // paid for any more, so ageing created_at alone would leave a booking whose customer
    // still has time -- and correctly not select it.
    await ds.query(
      `UPDATE bookings SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [created.body.booking.id],
    );

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('expired'); // not silently resurrected to confirmed

    const [payment] = await ds.query('SELECT status, refund_requested_at FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    expect(payment.status).toBe('refund_pending'); // Zarinpal captured money for a dead booking -- refund it, don't just log
    expect(payment.refund_requested_at).not.toBeNull();
  });
});
