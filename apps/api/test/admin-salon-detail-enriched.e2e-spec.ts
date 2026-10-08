import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApprovedSalon, createService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon detail -- enriched checklist data (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let salonId: string;
  let ownerId: string;
  let otherSalonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    adminCookie = await loginAsAdmin(app, '09151240099');

    const ownerCookie = await loginAs(app, '09151240001');
    ({ salonId } = await createApprovedSalon(app, ownerCookie, { name: 'Checklist Salon', lat: 35.71, lng: 51.41 }));
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', ownerCookie).expect(200);
    ownerId = me.body.id;
    const categoryId = (await request(app.getHttpServer()).get('/api/categories')).body[0].id;
    await createService(app, ownerCookie, categoryId, { name: 'Cut', price: 400000 });
    await createService(app, ownerCookie, categoryId, { name: 'Colour', pricingType: 'range', price: 100000, priceMax: 300000 });
    await ds.query(`INSERT INTO salon_photos (salon_id, url, sort_order, is_cover, storage_key) VALUES ($1, '/uploads/a.jpg', 1, false, 'a'), ($1, '/uploads/b.jpg', 0, true, 'b')`, [salonId]);

    const otherOwner = await loginAs(app, '09151240002');
    ({ salonId: otherSalonId } = await createApprovedSalon(app, otherOwner, { name: 'Other Salon' }));

    // Risk fixtures: 5 bookings in the window + 1 outside it. Statuses are written as
    // strings, including one ('cancelled_by_admin') that only exists once the booking
    // trust work lands -- it must simply not be counted as a salon cancellation.
    const customer = await loginAs(app, '09151240003');
    const cu = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', customer).expect(200);
    const [{ id: serviceId }] = await ds.query(`SELECT id FROM salon_services WHERE salon_id = $1 LIMIT 1`, [salonId]);
    const insert = (status: string, source: string, ageDays: number, sId = salonId) =>
      ds.query(
        `INSERT INTO bookings (salon_id, user_id, service_id, worker_id, starts_at, ends_at, status, price_snapshot, deposit_amount, source, created_at)
         VALUES ($1, $2, $3, NULL, now() + interval '5 days', now() + interval '5 days 1 hour', $4, 100000, 0, $5, now() - ($6 || ' days')::interval)`,
        [sId, cu.body.id, serviceId, status, source, String(ageDays)],
      );
    await insert('cancelled_by_salon', 'online', 1);
    await insert('rejected_by_salon', 'online', 2);
    await insert('no_show', 'manual', 3);
    await insert('confirmed', 'online', 4);
    await insert('cancelled_by_admin', 'online', 5);
    await insert('cancelled_by_salon', 'online', 120); // outside the 90-day window
    await ds.query(
      `INSERT INTO reports (reporter_id, salon_id, target_type, reason, status) VALUES ($1, $2, 'salon', 'x reason', 'open'), ($1, $2, 'salon', 'old', 'resolved')`,
      [cu.body.id, salonId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps every existing top-level field and adds owner, location, photos, services, hours and riskSummary', async () => {
    const res = await request(app.getHttpServer()).get(`/api/admin/salons/${salonId}`).set('Cookie', adminCookie).expect(200);

    expect(res.body).toMatchObject({ id: salonId, name: 'Checklist Salon', status: 'approved', ownerId, capacity: 1 });
    expect(res.body.owner).toMatchObject({ id: ownerId, phone: '09151240001', status: 'active' });
    expect(res.body.location).toEqual({ lat: 35.71, lng: 51.41 });
    expect(res.body.photos.map((p: { url: string }) => p.url)).toEqual(['/uploads/b.jpg', '/uploads/a.jpg']);
    expect(res.body.services).toHaveLength(2);
    expect(res.body.services.find((s: { name: string }) => s.name === 'Colour')).toMatchObject({
      pricingType: 'range', price: 100000, priceMax: 300000, durationMinutes: 60, isActive: true,
    });
    expect(res.body.hours).toHaveLength(7);
    expect(res.body.hours[0]).toMatchObject({ dayOfWeek: 0, openTime: '00:00:00', closeTime: '23:00:00', isClosed: false });
  });

  it('computes riskSummary over the last 90 days for THIS salon only', async () => {
    const res = await request(app.getHttpServer()).get(`/api/admin/salons/${salonId}`).set('Cookie', adminCookie).expect(200);
    expect(res.body.riskSummary).toEqual({
      bookingsTotal: 5,
      onlineBookings: 4,
      manualBookings: 1,
      cancelledBySalon: 1, // the 120-day-old one and the admin cancellation are not counted
      rejectedBySalon: 1,
      noShowMarked: 1,
      openReports: 1,
    });

    const other = await request(app.getHttpServer()).get(`/api/admin/salons/${otherSalonId}`).set('Cookie', adminCookie).expect(200);
    expect(other.body.riskSummary).toEqual({
      bookingsTotal: 0, onlineBookings: 0, manualBookings: 0, cancelledBySalon: 0, rejectedBySalon: 0, noShowMarked: 0, openReports: 0,
    });
  });

  it('shows closed days when a salon has no working hours', async () => {
    await ds.query(`DELETE FROM working_hours WHERE salon_id = $1`, [otherSalonId]);
    const res = await request(app.getHttpServer()).get(`/api/admin/salons/${otherSalonId}`).set('Cookie', adminCookie).expect(200);
    expect(res.body.hours).toHaveLength(7);
    expect(res.body.hours.every((h: { isClosed: boolean }) => h.isClosed)).toBe(true);
  });
});
