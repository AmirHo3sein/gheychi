import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Per-staff booking selection (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let salonSlug: string;
  let salonId: string;
  let serviceId: string;
  let worker1Id: string;
  let worker2Id: string;

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09141110001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Worker Selection Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      // Deliberately >1: capacity must never be the thing that blocks a second
      // customer -- only the shared worker should be.
      capacity: 5,
      categoryIds: [categoriesRes.body[0].id],
    });
    salonId = salonRes.body.id;
    salonSlug = salonRes.body.slug;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 500_000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const worker1Res = await request(app.getHttpServer())
      .post('/api/salons/mine/workers')
      .set('Cookie', ownerCookie)
      .send({ name: 'Sara', phone: '09141110002' })
      .expect(201);
    worker1Id = worker1Res.body.id;

    const worker2Res = await request(app.getHttpServer())
      .post('/api/salons/mine/workers')
      .set('Cookie', ownerCookie)
      .send({ name: 'Leila', phone: '09141110003' })
      .expect(201);
    worker2Id = worker2Res.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('records the chosen worker on the booking', async () => {
    const customerCookie = await loginAs(app, '09141110010');
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24), workerId: worker1Id })
      .expect(201);

    expect(res.body.booking.workerId).toBe(worker1Id);
  });

  it('leaves workerId null when no worker is chosen -- "any available staff", unchanged default', async () => {
    const customerCookie = await loginAs(app, '09141110011');
    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(48) })
      .expect(201);

    expect(res.body.booking.workerId).toBeNull();
  });

  it('409s a second customer booking the SAME worker at an overlapping time, even with spare salon capacity', async () => {
    const startsAt = futureIso(72);
    const first = await loginAs(app, '09141110012');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', first)
      .send({ salonId, serviceId, startsAt, workerId: worker1Id })
      .expect(201);

    const second = await loginAs(app, '09141110013');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', second)
      .send({ salonId, serviceId, startsAt, workerId: worker1Id })
      .expect(409);
  });

  it('accepts a second customer at the SAME time for a DIFFERENT worker (capacity allows it)', async () => {
    const startsAt = futureIso(96);
    const first = await loginAs(app, '09141110014');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', first)
      .send({ salonId, serviceId, startsAt, workerId: worker1Id })
      .expect(201);

    const second = await loginAs(app, '09141110015');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', second)
      .send({ salonId, serviceId, startsAt, workerId: worker2Id })
      .expect(201);
  });

  it('404s when the chosen worker does not belong to this salon', async () => {
    const customerCookie = await loginAs(app, '09141110016');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(120), workerId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });

  it('400s when the chosen worker belongs to the salon but is inactive', async () => {
    const inactive = await request(app.getHttpServer())
      .post('/api/salons/mine/workers')
      .set('Cookie', ownerCookie)
      .send({ name: 'Retired', phone: '09141110017' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/workers/${inactive.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ active: false })
      .expect(200);

    const customerCookie = await loginAs(app, '09141110018');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(144), workerId: inactive.body.id })
      .expect(400);
  });

  it('excludes a slot from GET availability for the requested worker once they are booked, while leaving it for "any available"', async () => {
    // Booking creation doesn't require a slot-grid-aligned startsAt (only a future
    // instant + no overlap) -- but GET availability's slots are quantized (hourly, on
    // the hour, Iran time). Fetch a REAL slot first so the later inclusion/exclusion
    // assertions compare against an actual grid entry, not an arbitrary offset from now
    // that would never equal any computed slot string regardless of this test's outcome.
    const initialSlots = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const startsAt: string = initialSlots.body.flatMap((d: { slots: string[] }) => d.slots)[0];
    expect(startsAt).toBeTruthy();

    const booker = await loginAs(app, '09141110019');
    await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', booker)
      .send({ salonId, serviceId, startsAt, workerId: worker1Id })
      .expect(201);

    const anyStaff = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const worker1Slots = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId, workerId: worker1Id })
      .expect(200);
    const worker2Slots = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId, workerId: worker2Id })
      .expect(200);

    const flatten = (days: Array<{ slots: string[] }>) => days.flatMap((d) => d.slots);
    expect(flatten(anyStaff.body)).toContain(startsAt);
    expect(flatten(worker1Slots.body)).not.toContain(startsAt);
    expect(flatten(worker2Slots.body)).toContain(startsAt);
  });

  it('public GET /salons/:slug/workers lists only active workers with the minimal projection', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers`).expect(200);
    const names = res.body.map((w: { name: string }) => w.name);
    expect(names).toEqual(expect.arrayContaining(['Sara', 'Leila']));
    expect(names).not.toContain('Retired'); // deactivated above
    expect(res.body[0]).not.toHaveProperty('userId');
    expect(res.body[0]).not.toHaveProperty('phone');
  });

  describe('per-worker service restriction', () => {
    let colorServiceId: string;

    beforeAll(async () => {
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      const colorRes = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', ownerCookie)
        .send({ categoryId: categoriesRes.body[0].id, name: 'Color', price: 800_000, durationMin: 60 });
      colorServiceId = colorRes.body.id;

      // Restrict worker1 (Sara) to only the original "Cut" service. Worker2 (Leila) is
      // left untouched -- still unrestricted, eligible for everything.
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}/services`)
        .set('Cookie', ownerCookie)
        .send({ serviceIds: [serviceId] })
        .expect(200);
    });

    it('GET .../workers?serviceId= includes an unrestricted worker but excludes one restricted away from it', async () => {
      const forColor = await request(app.getHttpServer())
        .get(`/api/salons/${salonSlug}/workers`)
        .query({ serviceId: colorServiceId })
        .expect(200);
      const namesForColor = forColor.body.map((w: { name: string }) => w.name);
      expect(namesForColor).not.toContain('Sara');
      expect(namesForColor).toContain('Leila');

      const forCut = await request(app.getHttpServer())
        .get(`/api/salons/${salonSlug}/workers`)
        .query({ serviceId })
        .expect(200);
      const namesForCut = forCut.body.map((w: { name: string }) => w.name);
      expect(namesForCut).toEqual(expect.arrayContaining(['Sara', 'Leila']));
    });

    it('GET .../workers with no serviceId is unaffected -- still lists every active worker', async () => {
      const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/workers`).expect(200);
      const names = res.body.map((w: { name: string }) => w.name);
      expect(names).toEqual(expect.arrayContaining(['Sara', 'Leila']));
    });

    it('booking the restricted worker for an eligible service still succeeds', async () => {
      const customerCookie = await loginAs(app, '09141110020');
      await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(168), workerId: worker1Id })
        .expect(201);
    });

    it('400s booking the restricted worker for a service they are not assigned to', async () => {
      const customerCookie = await loginAs(app, '09141110021');
      await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId: colorServiceId, startsAt: futureIso(192), workerId: worker1Id })
        .expect(400);
    });

    it('GET availability for the restricted worker + an ineligible service returns no slots at all', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/salons/${salonId}/availability`)
        .query({ serviceId: colorServiceId, workerId: worker1Id })
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('400s assign-worker onto an existing booking when the worker is restricted away from that booking\'s service', async () => {
      const customerCookie = await loginAs(app, '09141110022');
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId: colorServiceId, startsAt: futureIso(216) })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${created.body.booking.id}/assign-worker`)
        .set('Cookie', ownerCookie)
        .send({ workerId: worker1Id })
        .expect(400);
    });

    it('clearing serviceIds back to an empty array makes the worker unrestricted again', async () => {
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}/services`)
        .set('Cookie', ownerCookie)
        .send({ serviceIds: [] })
        .expect(200);

      const forColor = await request(app.getHttpServer())
        .get(`/api/salons/${salonSlug}/workers`)
        .query({ serviceId: colorServiceId })
        .expect(200);
      expect(forColor.body.map((w: { name: string }) => w.name)).toContain('Sara');

      // Restore the restriction for any tests that might run after this describe block
      // in the future -- keeps this block's own effects fully self-contained.
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${worker1Id}/services`)
        .set('Cookie', ownerCookie)
        .send({ serviceIds: [serviceId] })
        .expect(200);
    });
  });

  describe('assign-worker rejects a double-booking', () => {
    it('409s assigning a worker onto a booking that overlaps one they are already assigned to', async () => {
      const startsAt = futureIso(240);
      const bookerA = await loginAs(app, '09141110023');
      const first = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', bookerA)
        .send({ salonId, serviceId, startsAt })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${first.body.booking.id}/assign-worker`)
        .set('Cookie', ownerCookie)
        .send({ workerId: worker2Id })
        .expect(200);

      // A second, distinct booking at the SAME time (salon capacity 5 allows this) --
      // assigning the SAME worker who is already busy at that instant must be rejected,
      // exactly like createHold's own worker-overlap check would reject choosing them at
      // booking time.
      const bookerB = await loginAs(app, '09141110024');
      const second = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', bookerB)
        .send({ salonId, serviceId, startsAt })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${second.body.booking.id}/assign-worker`)
        .set('Cookie', ownerCookie)
        .send({ workerId: worker2Id })
        .expect(409);

      // The first booking's assignment is untouched by the rejected second attempt.
      const bookings = await request(app.getHttpServer())
        .get('/api/salons/mine/bookings')
        .set('Cookie', ownerCookie)
        .expect(200);
      const firstRow = bookings.body.find((b: { id: string }) => b.id === first.body.booking.id);
      expect(firstRow.workerId).toBe(worker2Id);
    });

    it('concurrency: two simultaneous assign-worker requests for the same worker at overlapping times -- exactly one succeeds', async () => {
      const startsAt = futureIso(264);
      const bookerC = await loginAs(app, '09141110025');
      const bookerD = await loginAs(app, '09141110026');
      // Sequential, not concurrent: booking creation itself serializes on the very same
      // per-salon Redis lock assign-worker now shares (that's the point being tested) --
      // two simultaneous createHold calls for the same salon would just race each other
      // for that unrelated reason. The actual concurrency under test is the pair of
      // assign-worker calls below.
      const bookingC = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', bookerC)
        .send({ salonId, serviceId, startsAt })
        .expect(201);
      const bookingD = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', bookerD)
        .send({ salonId, serviceId, startsAt })
        .expect(201);

      const [assignC, assignD] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/salons/mine/bookings/${bookingC.body.booking.id}/assign-worker`)
          .set('Cookie', ownerCookie)
          .send({ workerId: worker2Id }),
        request(app.getHttpServer())
          .patch(`/api/salons/mine/bookings/${bookingD.body.booking.id}/assign-worker`)
          .set('Cookie', ownerCookie)
          .send({ workerId: worker2Id }),
      ]);

      const statuses = [assignC.status, assignD.status].sort();
      // One request wins the per-salon lock first, sees no overlap, and succeeds; the
      // other either loses the lock race (409, "try again") or wins the lock next but
      // then sees the first request's now-committed overlapping booking (409, "already
      // has another appointment") -- both are the same class of correctly-rejected
      // double-booking attempt, so either concrete pairing here is a valid, race-free
      // outcome. What must never happen is both succeeding.
      expect(statuses).toEqual([200, 409]);
    });
  });
});
