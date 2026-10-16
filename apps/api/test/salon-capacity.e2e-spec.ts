import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { addDays } from '../src/booking/capacity.util';
import { iranDateString, iranWallClockToInstant } from '../src/common/iran-time.util';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * GET /salons/mine/capacity and the ?from&to window on GET /salons/mine/bookings. Online
 * payments stay at the seeded OFF default, so a booking is confirmed (slot-blocking) the
 * moment it is created -- no payment round-trip needed.
 */
describe('Salon capacity + bookings date window (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let bookingId: string;
  let tomorrow: string;
  let dayAfter: string;

  async function setNineToFive(id: string): Promise<void> {
    await ds.query(`DELETE FROM working_hours WHERE salon_id = $1`, [id]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '09:00', '17:00'`,
      [id],
    );
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09125550001');
    otherOwnerCookie = await loginAs(app, '09125550002');
    customerCookie = await loginAs(app, '09125550003');

    let serviceId: string;
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { capacity: 2 }, { durationMin: 60 }));
    await setNineToFive(salonId);
    const other = await createApprovedSalonWithService(app, otherOwnerCookie, { capacity: 1 });
    await setNineToFive(other.salonId);

    tomorrow = addDays(iranDateString(new Date()), 1);
    dayAfter = addDays(tomorrow, 1);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: iranWallClockToInstant(tomorrow, 10 * 60).toISOString() })
      .expect(201);
    bookingId = created.body.booking.id;
    expect(created.body.booking.status).toBe('confirmed');

    await ds.query(`INSERT INTO schedule_exceptions (salon_id, date, is_closed) VALUES ($1, $2, true)`, [salonId, dayAfter]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /salons/mine/capacity', () => {
    it('401s anonymously and 404s for a caller without a salon', async () => {
      await request(app.getHttpServer()).get('/api/salons/mine/capacity').expect(401);
      await request(app.getHttpServer()).get('/api/salons/mine/capacity').set('Cookie', customerCookie).expect(404);
    });

    it('computes a real day: 8 open hours x 2 chairs, one 60-minute booking', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/salons/mine/capacity')
        .query({ from: tomorrow, to: addDays(tomorrow, 2) })
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(body.from).toBe(tomorrow);
      expect(body.capacity).toBe(2);
      expect(body.days).toHaveLength(2);
      expect(body.days[0]).toMatchObject({
        date: tomorrow,
        closedReason: null,
        openMinutes: 480,
        capacityMinutes: 960,
        bookedMinutes: 60,
        freeMinutes: 900,
        freePercent: 94,
        bookingsCount: 1,
      });
      expect(body.days[1]).toMatchObject({ date: dayAfter, closedReason: 'closed_exception', openMinutes: 0, freePercent: null });
      expect(body.totals).toEqual({ openMinutes: 480, capacityMinutes: 960, bookedMinutes: 60, freeMinutes: 900, freePercent: 94 });
    });

    it('stops counting a booking once it no longer blocks the slot', async () => {
      await ds.query(`UPDATE bookings SET status = 'cancelled_by_user' WHERE id = $1`, [bookingId]);
      const { body } = await request(app.getHttpServer())
        .get('/api/salons/mine/capacity')
        .query({ from: tomorrow, to: dayAfter })
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(body.days[0]).toMatchObject({ bookedMinutes: 0, freePercent: 100, bookingsCount: 0 });
      await ds.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    });

    it("is tenant-isolated: another owner sees only their own salon's capacity and bookings", async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/salons/mine/capacity')
        .query({ from: tomorrow, to: addDays(tomorrow, 2) })
        .set('Cookie', otherOwnerCookie)
        .expect(200);
      expect(body.capacity).toBe(1);
      expect(body.days[0]).toMatchObject({ capacityMinutes: 480, bookedMinutes: 0, bookingsCount: 0 });
      expect(body.days[1].closedReason).toBeNull(); // the exception belongs to the first salon
    });

    it('defaults to seven days from today (Tehran)', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/salons/mine/capacity').set('Cookie', ownerCookie).expect(200);
      expect(body.from).toBe(iranDateString(new Date()));
      expect(body.days).toHaveLength(7);
    });

    it('400s on a bad date, an empty window, and a window over 31 days', async () => {
      const get = (query: Record<string, string>) =>
        request(app.getHttpServer()).get('/api/salons/mine/capacity').query(query).set('Cookie', ownerCookie);
      await get({ from: '2026-13-01' }).expect(400);
      await get({ from: '2026-10-17T00:00:00Z' }).expect(400);
      await get({ from: tomorrow, to: tomorrow }).expect(400);
      await get({ from: tomorrow, to: addDays(tomorrow, 32) }).expect(400);
      await get({ from: tomorrow, to: addDays(tomorrow, 31) }).expect(200);
    });
  });

  describe('GET /salons/mine/bookings?from&to', () => {
    const list = (cookie: string, query: Record<string, string> = {}) =>
      request(app.getHttpServer()).get('/api/salons/mine/bookings').query(query).set('Cookie', cookie);

    it('keeps the unfiltered listing when no window is given', async () => {
      const { body } = await list(ownerCookie).expect(200);
      expect(body.map((b: { id: string }) => b.id)).toEqual([bookingId]);
    });

    it('includes a booking inside [from, to) and excludes one outside it (to is exclusive)', async () => {
      const dayStart = iranWallClockToInstant(tomorrow, 0).toISOString();
      const dayEnd = iranWallClockToInstant(dayAfter, 0).toISOString();
      const inside = await list(ownerCookie, { from: dayStart, to: dayEnd }).expect(200);
      expect(inside.body.map((b: { id: string }) => b.id)).toEqual([bookingId]);

      const startsAt = iranWallClockToInstant(tomorrow, 10 * 60).toISOString();
      const endingAtStart = await list(ownerCookie, { from: dayStart, to: startsAt }).expect(200);
      expect(endingAtStart.body).toEqual([]);
      const fromStart = await list(ownerCookie, { from: startsAt }).expect(200);
      expect(fromStart.body).toHaveLength(1);
      const later = await list(ownerCookie, { from: dayEnd }).expect(200);
      expect(later.body).toEqual([]);
    });

    it("never returns another salon's bookings inside the same window", async () => {
      const { body } = await list(otherOwnerCookie, {
        from: iranWallClockToInstant(tomorrow, 0).toISOString(),
        to: iranWallClockToInstant(dayAfter, 0).toISOString(),
      }).expect(200);
      expect(body).toEqual([]);
    });

    it('400s on a non-ISO bound and on from >= to', async () => {
      await list(ownerCookie, { from: 'yesterday' }).expect(400);
      const t = iranWallClockToInstant(tomorrow, 0).toISOString();
      await list(ownerCookie, { from: t, to: t }).expect(400);
    });

    it('400s on a bound without a time zone offset (bare date or offset-less date-time)', async () => {
      // Both would otherwise be read as UTC midnight / server-local time -- a silently shifted window.
      await list(ownerCookie, { from: tomorrow }).expect(400);
      await list(ownerCookie, { to: `${dayAfter}T00:00:00` }).expect(400);
    });
  });
});
