import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Schedule (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09123330000');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Sched Salon',
      genderTarget: 'women',
      address: 'Azadi St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.35,
      categoryIds: [categoryId],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('replaces the weekly hours', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [
        { weekday: 6, openTime: '09:00', closeTime: '18:00' },
        { weekday: 0, openTime: '09:00', closeTime: '13:00' },
        { weekday: 0, openTime: '15:00', closeTime: '20:00' },
      ]})
      .expect(200);
    expect(res.body.length).toBe(3);

    const res2 = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '10:00', closeTime: '19:00' }] })
      .expect(200);
    expect(res2.body.length).toBe(1);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(1);
  });

  it('rejects an inverted range', () =>
    request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '18:00', closeTime: '09:00' }] })
      .expect(400));

  it('rejects two overlapping ranges submitted for the same weekday', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [
        { weekday: 1, openTime: '09:00', closeTime: '13:00' },
        { weekday: 1, openTime: '12:00', closeTime: '17:00' },
      ]})
      .expect(400);
    expect(res.body.message).toContain('Overlapping working hours');

    // Nothing was written -- the previously-saved schedule from the earlier test is untouched.
    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('accepts back-to-back ranges on the same weekday that only touch at a shared boundary', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [
        { weekday: 2, openTime: '09:00', closeTime: '12:00' },
        { weekday: 2, openTime: '12:00', closeTime: '18:00' },
      ]})
      .expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('adds and removes a closed-day exception', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-01' })
      .expect(201);
    expect(created.body.isClosed).toBe(true);
    expect(created.body.startTime).toBeNull();
    expect(created.body.endTime).toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/exceptions/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(0);
  });

  it('adds a partial-day exception with a reason', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-02', startTime: '13:00', endTime: '14:00', reason: 'ناهار' })
      .expect(201);
    expect(created.body.reason).toBe('ناهار');

    // The create response just echoes back what TypeORM's .save() was given, not a real
    // round-trip through Postgres -- list separately to confirm what's actually stored (pg
    // returns `time` columns as HH:MM:SS, per HoursView.vue's own comment on working_hours).
    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .expect(200);
    const stored = list.body.find((e: { id: string }) => e.id === created.body.id);
    expect(stored.startTime).toBe('13:00:00');
    expect(stored.endTime).toBe('14:00:00');

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/exceptions/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
  });

  it('rejects a partial-day exception with only one of startTime/endTime set', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-03', startTime: '13:00' })
      .expect(400));

  it('rejects a partial-day exception with an inverted time range', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-04', startTime: '14:00', endTime: '13:00' })
      .expect(400));

  describe('per-worker time off', () => {
    let worker1Id: string;
    let worker2Id: string;
    let serviceId: string;

    beforeAll(async () => {
      const w1 = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', cookie)
        .send({ name: 'Sara', phone: '09123330001' })
        .expect(201);
      worker1Id = w1.body.id;

      const w2 = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', cookie)
        .send({ name: 'Leila', phone: '09123330002' })
        .expect(201);
      worker2Id = w2.body.id;

      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      const serviceRes = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', cookie)
        .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 500_000, durationMin: 60 });
      serviceId = serviceRes.body.id;

      // The public exceptions listing and the availability endpoint both only ever serve an
      // approved salon -- this suite's salon starts out pending, same as every new salon.
      const salonRes = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
      await app.get(DataSource).query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonRes.body.id]);

      // The whole-week schedule from the earlier tests in this file may not cover every
      // weekday -- give this worker a wide-open week so the availability assertions below
      // are never confused with a genuine "salon closed that weekday" gap.
      await request(app.getHttpServer())
        .put('/api/salons/mine/hours')
        .set('Cookie', cookie)
        .send({ hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '00:00', closeTime: '23:59' })) })
        .expect(200);
    });

    it('creates a whole-day exception scoped to one worker', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-01', workerId: worker1Id })
        .expect(201);
      expect(created.body.workerId).toBe(worker1Id);
      expect(created.body.isClosed).toBe(true);
    });

    it('404s when the given workerId does not belong to this salon', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-02', workerId: '00000000-0000-0000-0000-000000000000' })
        .expect(404));

    it('rejects a partial-hour exception scoped to a worker -- v1 only supports whole-day per-worker', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-04', workerId: worker1Id, startTime: '13:00', endTime: '14:00' })
        .expect(400));

    it('409s on a duplicate whole-salon closure for the same date', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-05' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-05' })
        .expect(409);
    });

    it('409s on a duplicate per-worker closure for the same worker and date', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-06', workerId: worker1Id })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-06', workerId: worker1Id })
        .expect(409);

      // A DIFFERENT worker off on the exact same date is not a duplicate -- the partial
      // unique index is scoped by (salon_id, date, worker_id), not just (salon_id, date).
      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-06', workerId: worker2Id })
        .expect(201);
    });

    it('allows a whole-salon closure and a per-worker closure on the SAME date to coexist', async () => {
      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-03' }) // whole-salon
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: '2026-09-03', workerId: worker1Id })
        .expect(201);
    });

    it('?workerId= filters the list to just that worker\'s own rows', async () => {
      const filtered = await request(app.getHttpServer())
        .get('/api/salons/mine/exceptions')
        .query({ workerId: worker1Id })
        .set('Cookie', cookie)
        .expect(200);
      expect(filtered.body.length).toBeGreaterThan(0);
      expect(filtered.body.every((e: { workerId: string | null }) => e.workerId === worker1Id)).toBe(true);
    });

    it('a public salon-exceptions listing never shows a single worker\'s day off as a whole-salon closure', async () => {
      const salonRes = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
      const publicList = await request(app.getHttpServer())
        .get(`/api/salons/${salonRes.body.slug}/exceptions`)
        .expect(200);
      // Every date in the public list must be a genuine whole-salon closure -- the
      // per-worker-only date (2026-09-01, worker1 alone) must not appear as if it were one.
      // (2026-09-03 legitimately appears too, since it also has its own whole-salon row.)
      expect(publicList.body.some((e: { date: string }) => e.date === '2026-09-01')).toBe(false);
    });

    it('excludes the day from that specific worker\'s availability, but not from "any available worker"', async () => {
      const salonRes = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
      const salonId = salonRes.body.id;

      // Availability only ever looks 14 days out from the real current time (see
      // AVAILABILITY_WINDOW_DAYS) -- a fixed calendar date would drift outside that window
      // depending on when this suite runs, so this is computed relative to now instead.
      const dayOff = new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString().slice(0, 10);
      await request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', cookie)
        .send({ date: dayOff, workerId: worker1Id })
        .expect(201);

      const worker1Availability = await request(app.getHttpServer())
        .get(`/api/salons/${salonId}/availability`)
        .query({ serviceId, workerId: worker1Id })
        .expect(200);
      expect(worker1Availability.body.find((d: { date: string }) => d.date === dayOff)).toBeUndefined();

      const worker2Availability = await request(app.getHttpServer())
        .get(`/api/salons/${salonId}/availability`)
        .query({ serviceId, workerId: worker2Id })
        .expect(200);
      expect(worker2Availability.body.find((d: { date: string }) => d.date === dayOff)).toBeDefined();

      const anyWorkerAvailability = await request(app.getHttpServer())
        .get(`/api/salons/${salonId}/availability`)
        .query({ serviceId })
        .expect(200);
      expect(anyWorkerAvailability.body.find((d: { date: string }) => d.date === dayOff)).toBeDefined();
    });
  });
});
