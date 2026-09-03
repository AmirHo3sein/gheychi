import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * The two halves of "the customer's deposit was forfeited to the salon":
 *
 *  1. A no-show may only be recorded once the appointment could actually have been missed
 *     (`no_show_grace_minutes`). Before this guard a salon could mark a booking days ahead
 *     no_show the moment its deposit was captured -- and since no_show is not a cancellable
 *     status, the customer lost every route to a refund they were still entitled to.
 *  2. A forfeited deposit accrues platform commission the same way whether it was forfeited
 *     by a no-show or by a late cancellation. The design spec always said both, but only the
 *     no-show half was implemented, so the platform silently kept 100% of every
 *     late-cancellation deposit and the salon's invoice never showed it.
 */
describe('Forfeited deposits: no-show eligibility + commission consistency (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;

  const futureIso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

  /** A confirmed, really-paid booking -- the only state from which a deposit can be forfeited. */
  async function paidBooking(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(hoursFromNow) })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    return created.body.booking.id;
  }

  /** Drags a booking's start time into the past -- createHold refuses to create one there. */
  async function backdate(bookingId: string, minutesAgo: number): Promise<void> {
    await ds.query(
      `UPDATE bookings SET starts_at = now() - ($2 || ' minutes')::interval, ends_at = now() - (($2::int - 30) || ' minutes')::interval WHERE id = $1`,
      [bookingId, String(minutesAgo)],
    );
  }

  async function ledgerRowsFor(bookingId: string): Promise<Array<{ gross_amount: string; commission_amount: string }>> {
    return ds.query(`SELECT gross_amount, commission_amount FROM financial_transactions WHERE booking_id = $1`, [bookingId]);
  }

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09141110001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'Forfeiture Test Salon' },
      { price: 1_000_000 },
    ));
    customerCookie = await loginAs(app, '09141110002');
    adminCookie = await loginAsAdmin(app, '09141110003');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('no-show eligibility', () => {
    it('refuses a no-show on a booking that has not started yet', async () => {
      const bookingId = await paidBooking(48);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'no_show' })
        .expect(400);

      const [row] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
      expect(row.status).toBe('confirmed');
      expect(await ledgerRowsFor(bookingId)).toHaveLength(0);
    });

    it('refuses a no-show inside the grace window, then allows it once the window has elapsed', async () => {
      const bookingId = await paidBooking(72);

      // Started 10 minutes ago -- inside the seeded 30-minute grace period.
      await backdate(bookingId, 10);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'no_show' })
        .expect(400);

      await backdate(bookingId, 45);
      const res = await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'no_show' })
        .expect(200);
      expect(res.body.status).toBe('no_show');
    });

    it('honours an admin-edited grace period rather than a hardcoded one', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Cookie', adminCookie)
        .send({ updates: [{ key: 'no_show_grace_minutes', value: 120 }] })
        .expect(200);

      const bookingId = await paidBooking(96);
      // 45 minutes late would have been enough under the seeded 30, but not under 120.
      await backdate(bookingId, 45);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'no_show' })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Cookie', adminCookie)
        .send({ updates: [{ key: 'no_show_grace_minutes', value: 30 }] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'no_show' })
        .expect(200);
    });

    it('never time-guards a completion -- a salon may close out a booking early', async () => {
      const bookingId = await paidBooking(120);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);
    });
  });

  describe('forfeited-deposit commission', () => {
    it('accrues commission on a late customer cancellation, exactly as it does on a no-show', async () => {
      const bookingId = await paidBooking(2); // inside the 24h cancellation window => forfeited

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', customerCookie)
        .expect(200);

      const [booking] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
      expect(booking.status).toBe('cancelled_by_user');
      const [payment] = await ds.query(`SELECT status, amount FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payment.status).toBe('paid'); // forfeited, not refunded

      const rows = await ledgerRowsFor(bookingId);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.gross_amount)).toBe(Number(payment.amount));
      expect(Number(rows[0]!.commission_amount)).toBe(Math.round(Number(payment.amount) * 0.1)); // seeded 10%
    });

    it('accrues nothing when the cancellation is refunded -- that money goes back to the customer', async () => {
      const bookingId = await paidBooking(144); // outside the window => refunded

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', customerCookie)
        .expect(200);

      const [payment] = await ds.query(`SELECT status FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(['refund_pending', 'refunded']).toContain(payment.status);
      expect(await ledgerRowsFor(bookingId)).toHaveLength(0);
    });

    it('accrues nothing when a salon cancels, which always refunds the customer', async () => {
      const bookingId = await paidBooking(4); // inside the window, but the SALON is cancelling

      await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(await ledgerRowsFor(bookingId)).toHaveLength(0);
    });

    it('surfaces a forfeited late cancellation in the salon\'s own earnings, not just the ledger', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/salons/mine/earnings')
        .set('Cookie', ownerCookie)
        .expect(200);

      const bookingId = await paidBooking(6);
      await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/salons/mine/earnings')
        .set('Cookie', ownerCookie)
        .expect(200);
      const [payment] = await ds.query(`SELECT amount FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(after.body.totalCollected - before.body.totalCollected).toBe(Number(payment.amount));
      expect(after.body.netPayout).toBeGreaterThan(before.body.netPayout);
    });
  });
});
