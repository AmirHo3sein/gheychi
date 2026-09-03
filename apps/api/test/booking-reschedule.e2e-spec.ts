import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * Rescheduling: moving an existing booking without destroying it.
 *
 * The only path that existed before was cancel-and-rebook, which for a within-window
 * cancellation forfeited the customer's deposit through no fault of their own and threw
 * away the booking's whole history.
 *
 * The rule that matters most here is the customer-side window check. Reschedule must never
 * become a free escape hatch from deposit forfeiture: a customer an hour before their
 * appointment could otherwise push it a week out and then cancel "early" for a full refund,
 * which is exactly what the cancellation window exists to prevent.
 */
describe('Booking reschedule (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let customerCookie: string;
  let otherCustomerCookie: string;
  let salonId: string;
  let serviceId: string;

  const futureIso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

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

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09131110001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { name: 'Reschedule Salon' }));
    customerCookie = await loginAs(app, '09131110002');
    otherCustomerCookie = await loginAs(app, '09131110003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves the booking, keeping the same row, its payment and its history', async () => {
    const bookingId = await paidBooking(72);
    const [before] = await ds.query(`SELECT id, ends_at, starts_at FROM bookings WHERE id = $1`, [bookingId]);
    const [paymentBefore] = await ds.query(`SELECT id, status, amount FROM payments WHERE booking_id = $1`, [bookingId]);

    const newStart = futureIso(96);
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: newStart })
      .expect(200);
    expect(res.body.id).toBe(bookingId); // same booking, not a replacement
    expect(new Date(res.body.startsAt).toISOString()).toBe(newStart);

    const [after] = await ds.query(`SELECT starts_at, ends_at, status FROM bookings WHERE id = $1`, [bookingId]);
    expect(after.status).toBe('confirmed');
    // endsAt is recomputed from the service duration, never taken from the client.
    const durationMs = new Date(before.ends_at).getTime() - new Date(before.starts_at).getTime();
    expect(new Date(after.ends_at).getTime() - new Date(after.starts_at).getTime()).toBe(durationMs);

    // The captured deposit follows the appointment: nothing re-captured, nothing refunded.
    const [paymentAfter] = await ds.query(`SELECT id, status, amount FROM payments WHERE booking_id = $1`, [bookingId]);
    expect(paymentAfter).toMatchObject({ id: paymentBefore.id, status: 'paid', amount: paymentBefore.amount });

    const events = await ds.query(`SELECT event_type FROM booking_events WHERE booking_id = $1`, [bookingId]);
    expect(events.map((e: { event_type: string }) => e.event_type)).toEqual(expect.arrayContaining(['BOOKING_RESCHEDULED']));
  });

  it('refuses a customer reschedule inside the cancellation window -- it must not be a free late-cancel escape hatch', async () => {
    const bookingId = await paidBooking(2); // inside the seeded 24h window

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: futureIso(200) })
      .expect(409);

    const [row] = await ds.query(`SELECT starts_at FROM bookings WHERE id = $1`, [bookingId]);
    expect(new Date(row.starts_at).getTime()).toBeLessThan(Date.now() + 3 * 3_600_000);
  });

  it('lets the SALON move a booking that is already inside the cancellation window', async () => {
    const bookingId = await paidBooking(3);

    await request(app.getHttpServer())
      .post(`/api/salons/mine/bookings/${bookingId}/reschedule`)
      .set('Cookie', ownerCookie)
      .send({ startsAt: futureIso(220) })
      .expect(200);

    // ...and writes a real audit row, since a provider is a real actor.
    const audit = await ds.query(`SELECT action FROM audit_log WHERE action = 'booking.rescheduled'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses a time that is already taken to capacity', async () => {
    const clashAt = futureIso(320);
    // Fill the salon's capacity at the target time.
    const salon = await ds.query(`SELECT capacity FROM salons WHERE id = $1`, [salonId]);
    const capacity = Number(salon[0].capacity);
    for (let i = 0; i < capacity; i++) {
      const phone = `0913222${String(1000 + i).slice(-4)}`;
      const cookie = await loginAs(app, phone);
      await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', cookie)
        .send({ salonId, serviceId, startsAt: clashAt })
        .expect(201);
    }

    const bookingId = await paidBooking(400);
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: clashAt })
      .expect(409);
  });

  it('refuses a time in the past', async () => {
    const bookingId = await paidBooking(500);
    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: new Date(Date.now() - 3_600_000).toISOString() })
      .expect(400);
  });

  it('refuses to move a booking that is already cancelled', async () => {
    const bookingId = await paidBooking(520);
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customerCookie).expect(200);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: futureIso(540) })
      .expect(400);
  });

  it('refuses a reschedule by someone who is neither the customer nor the salon (IDOR)', async () => {
    const bookingId = await paidBooking(560);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', otherCustomerCookie)
      .send({ startsAt: futureIso(580) })
      .expect(403);
  });

  it("refuses a reschedule from a different salon's owner", async () => {
    const bookingId = await paidBooking(600);
    const otherOwnerCookie = await loginAs(app, '09131110004');
    await createApprovedSalonWithService(app, otherOwnerCookie, { name: 'Unrelated Salon' });

    await request(app.getHttpServer())
      .post(`/api/salons/mine/bookings/${bookingId}/reschedule`)
      .set('Cookie', otherOwnerCookie)
      .send({ startsAt: futureIso(620) })
      .expect(404);
  });

  it('clears remindedAt so the reminder fires again for the NEW time', async () => {
    const bookingId = await paidBooking(640);
    await ds.query(`UPDATE bookings SET reminded_at = now() WHERE id = $1`, [bookingId]);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/reschedule`)
      .set('Cookie', customerCookie)
      .send({ startsAt: futureIso(660) })
      .expect(200);

    const [row] = await ds.query(`SELECT reminded_at FROM bookings WHERE id = $1`, [bookingId]);
    expect(row.reminded_at).toBeNull();
  });
});
