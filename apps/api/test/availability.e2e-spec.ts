import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Availability (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09124440000');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;

    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Availability Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 1,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);

    // open every day 09:00-11:00 (weekdays 0-6)
    const hoursRows = Array.from({ length: 7 }, (_, weekday) => `('${salonId}', ${weekday}, '09:00', '11:00')`).join(',');
    await ds.query(`INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ${hoursRows}`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 14 days of availability with at least one slot per day', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.length).toBeLessThanOrEqual(14);
    expect(res.body[0].slots).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it('excludes a date added as a closed schedule exception', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const targetDate = before.body[0].date;

    const ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO schedule_exceptions (salon_id, date, is_closed) VALUES ($1, $2, true)`,
      [salonId, targetDate],
    );

    const after = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    expect(after.body.map((d: { date: string }) => d.date)).not.toContain(targetDate);
  });

  it('404s for a service that does not belong to the salon', () =>
    request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId: '00000000-0000-4000-8000-000000000099' })
      .expect(404));

  it('404s for a salon that is not approved', async () => {
    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'pending' WHERE id = $1`, [salonId]);
    await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(404);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
  });

  it('excludes a slot with a pending_payment booking, not just confirmed ones', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const targetDate = before.body[0].date;
    const targetSlot = before.body[0].slots[0];

    const ds = app.get(DataSource);
    const startsAt = new Date(targetSlot);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000); // service duration is 60min
    await ds.query(
      `INSERT INTO bookings (user_id, salon_id, service_id, starts_at, ends_at, price_snapshot, deposit_amount, status)
       SELECT id, $1, $2, $3, $4, 500000, 100000, 'pending_payment' FROM users LIMIT 1`,
      [salonId, serviceId, startsAt.toISOString(), endsAt.toISOString()],
    );

    const after = await request(app.getHttpServer())
      .get(`/api/salons/${salonId}/availability`)
      .query({ serviceId })
      .expect(200);
    const afterDay = after.body.find((d: { date: string }) => d.date === targetDate);
    expect(afterDay?.slots ?? []).not.toContain(targetSlot);
  });
});
