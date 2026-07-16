import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { RefundRetryJob } from '../src/booking/refund-retry.job';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Booking cancellation policy (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09124040009');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Cancellation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
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

    customerCookie = await loginAs(app, '09125050010');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookAndConfirm(hoursFromNow: number): Promise<{ bookingId: string; paymentId: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT id FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    return { bookingId: created.body.booking.id, paymentId: payment.id };
  }

  it('fully refunds a user cancelling well outside the 24h window', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);
    expect(res.body.status).toBe('cancelled_by_user');

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
    expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/); // a real gateway refund happened, not just bookkeeping
  });

  it('forfeits the deposit when the user cancels inside the 24h window', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(2);
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('paid'); // deposit stays with the salon, not refunded
  });

  it('always fully refunds when the salon cancels, regardless of timing', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(1);
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', ownerCookie)
      .expect(201);
    expect(res.body.status).toBe('cancelled_by_salon');

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
    expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/); // a real gateway refund happened, not just bookkeeping
  });

  it('rejects cancellation by someone who is neither the customer nor the salon owner', async () => {
    const { bookingId } = await bookAndConfirm(48);
    const stranger = await loginAs(app, '09126060011');
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', stranger)
      .expect(403);
  });

  it('rejects cancelling an already-cancelled booking', async () => {
    const { bookingId } = await bookAndConfirm(48);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(201);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(400);
  });

  it('marks a pending_payment (never-confirmed) cancellation\'s payment as failed, not refunded', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString() })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const ds = app.get(DataSource);
    const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    expect(payment.status).toBe('failed');
  });

  it('leaves the payment refund_pending when the gateway refuses the refund, without failing the cancel', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const ds = app.get(DataSource);
    // Force MockPaymentGateway.refundPayment to refuse by rewriting the authority
    // to contain the sentinel it checks for.
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE id = $1`, [paymentId]);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Cookie', customerCookie)
      .expect(201);

    const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refund_pending'); // owed, not yet issued -- RefundRetryJob picks it up
    expect(payment.refund_ref_id).toBeNull();
  });

  it('RefundRetryJob completes a refund the inline attempt could not', async () => {
    const { bookingId, paymentId } = await bookAndConfirm(48);
    const ds = app.get(DataSource);
    // First make the refund fail inline...
    await ds.query(`UPDATE payments SET authority = 'MOCK-REFUND-FAIL-' || authority WHERE id = $1`, [paymentId]);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(201);
    let [payment] = await ds.query('SELECT status FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refund_pending');

    // ...then heal the authority (gateway outage over), backdate past the grace period, and retry.
    await ds.query(
      `UPDATE payments SET authority = replace(authority, 'MOCK-REFUND-FAIL-', ''), refund_requested_at = now() - interval '10 minutes' WHERE id = $1`,
      [paymentId],
    );
    const job = app.get(RefundRetryJob);
    const refunded = await job.run();
    // >= rather than === : in a slow run, the earlier MOCK-REFUND-FAIL test's row can
    // age past the grace period and be (harmlessly, unsuccessfully) retried here too.
    expect(refunded).toBeGreaterThanOrEqual(1);

    [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE id = $1', [paymentId]);
    expect(payment.status).toBe('refunded');
    expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/);
  });
});
