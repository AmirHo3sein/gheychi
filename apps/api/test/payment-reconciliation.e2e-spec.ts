import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
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
    app = await createTestApp();
    job = app.get(PaymentReconciliationJob);

    const ownerCookie = await loginAs(app, '09121110015');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reconciliation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 2,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
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
    // to start with the sentinel prefix it checks for
    await ds.query(
      `UPDATE payments SET authority = 'MOCK-FAIL-' || authority, created_at = now() - interval '25 minutes' WHERE booking_id = $1`,
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

  it('does not resurrect an already-expired booking, but still marks the payment paid if Zarinpal confirms it', async () => {
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

    const reconciled = await job.run();
    expect(reconciled).toBe(1);

    const booking = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.booking.id}`)
      .set('Cookie', customerCookie)
      .expect(200);
    expect(booking.body.status).toBe('expired'); // not silently resurrected to confirmed

    const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [created.body.booking.id]);
    expect(payment.status).toBe('paid'); // Zarinpal genuinely captured the money -- flagged for manual review, not discarded
  });
});
