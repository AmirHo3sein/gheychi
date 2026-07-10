import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Reports — lifecycle (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let salonSlug: string;
  let serviceId: string;
  let reportId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09151110001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Report Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;
    salonSlug = salonRes.body.slug;

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

    customerCookie = await loginAs(app, '09152220002');
    adminCookie = await loginAsAdmin(app, '09153330003');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookPayAndComplete(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('requires auth to file a report', () =>
    request(app.getHttpServer()).post('/api/reports').send({ salonId, reason: 'اطلاعات سالن نادرست است' }).expect(401));

  it('reports canReport=false before any completed booking', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/reports/eligibility')
      .query({ salonId })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(res.body).toEqual({ canReport: false });
  });

  it('403s a report from a customer with no completed booking at the salon', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'اطلاعات سالن نادرست است' })
      .expect(403));

  it('creates an open salon report once the customer has a completed booking', async () => {
    await bookPayAndComplete(24);

    const eligibility = await request(app.getHttpServer())
      .get('/api/reports/eligibility')
      .query({ salonId })
      .set('Cookie', customerCookie)
      .expect(200);
    expect(eligibility.body).toEqual({ canReport: true });

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'اطلاعات سالن نادرست است' })
      .expect(201);
    expect(res.body.status).toBe('open');
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.reviewId).toBeNull();
    reportId = res.body.id;
  });

  it('409s a duplicate open report for the same salon', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'گزارش تکراری برای همین سالن' })
      .expect(409));

  it('400s a report naming both a salon and a review', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reviewId: '00000000-0000-4000-8000-000000000099', reason: 'هر دو هدف با هم' })
      .expect(400));

  it('404s a report for a nonexistent review', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ reviewId: '00000000-0000-4000-8000-000000000099', reason: 'این دیدگاه توهین‌آمیز است' })
      .expect(404));

  it('wrote exactly one report_created notification — the duplicate rolled back with its report', async () => {
    // Count holds because resetDatabase() gives this file a fresh schema and, at this point in the
    // describe, exactly one report has been created; the review-targeted report later adds a second row.
    const ds = app.get(DataSource);
    const rows = await ds.query(`SELECT type, title, body, link, read_at FROM admin_notifications WHERE type = 'report_created'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('گزارش جدید ثبت شد');
    expect(rows[0].body).toBe('اطلاعات سالن نادرست است');
    expect(rows[0].link).toBe('/reports');
    expect(rows[0].read_at).toBeNull();
  });

  it('403s the admin queue for a non-admin', () =>
    request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', customerCookie).expect(403));

  it('lists the open report with salon and reporter context for an admin', async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    const [item] = res.body.items;
    expect(item.id).toBe(reportId);
    expect(item.reason).toBe('اطلاعات سالن نادرست است');
    expect(item.salonName).toBe('Report Test Salon');
    expect(item.salonSlug).toBe(salonSlug);
    expect(item.reporterPhone).toBe('09152220002');
    expect(item.reviewRating).toBeNull();
    expect(item.reviewComment).toBeNull();
  });

  it('resolves the report, stamping resolver and time', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/reports/${reportId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'resolved', note: 'بررسی شد' })
      .expect(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolutionNote).toBe('بررسی شد');
    expect(res.body.resolvedBy).not.toBeNull();
    expect(res.body.resolvedAt).not.toBeNull();
  });

  it('wrote a report.resolve audit row for the admin action', async () => {
    const ds = app.get(DataSource);
    const rows = await ds.query(
      `SELECT action, target_type, target_id, success FROM audit_log WHERE action = 'report.resolve'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('report');
    expect(rows[0].target_id).toBe(reportId);
    expect(rows[0].success).toBe(true);
  });

  it('409s a second resolve of the same report (lost race)', () =>
    request(app.getHttpServer())
      .patch(`/api/admin/reports/${reportId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'dismissed' })
      .expect(409));

  it('excludes resolved reports from the default queue but shows them under status=resolved', async () => {
    const open = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    expect(open.body.total).toBe(0);

    const resolved = await request(app.getHttpServer())
      .get('/api/admin/reports')
      .query({ status: 'resolved' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(resolved.body.total).toBe(1);
    expect(resolved.body.items[0].id).toBe(reportId);
  });

  it('reports a review, deriving the salon and surfacing the review in the admin queue', async () => {
    const bookingId = await bookPayAndComplete(48);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 1, comment: 'توهین‌آمیز' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ reviewId: reviewRes.body.id, reason: 'این دیدگاه توهین‌آمیز است' })
      .expect(201);
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.reviewId).toBe(reviewRes.body.id);

    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item).toBeDefined();
    expect(item.reviewRating).toBe(1);
    expect(item.reviewComment).toBe('توهین‌آمیز');
  });
});
