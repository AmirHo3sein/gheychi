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
  let reportedStoryId: string;

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
      categoryIds: [categoryId],
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
    expect(res.body.targetType).toBe('salon');
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
    // describe, exactly one report has been created; the story/portfolio/review-targeted reports
    // later in the file each add another row.
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
    expect(item.targetType).toBe('salon');
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

  it('404s a report for a nonexistent story', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ storyId: '00000000-0000-4000-8000-000000000099', reason: 'محتوای نامناسب در استوری' })
      .expect(404));

  it('reports a story, deriving the salon and surfacing the story context in the admin queue', async () => {
    const ds = app.get(DataSource);
    const [{ id: storyId }] = await ds.query(
      `INSERT INTO salon_stories (salon_id, url, storage_key, caption, expires_at)
       VALUES ($1, 'http://x/uploads/story.jpg', 'salons/x/stories/a.jpg', 'کوتاهی مو', now() + interval '24 hours')
       RETURNING id`,
      [salonId],
    );
    reportedStoryId = storyId;

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ storyId, reason: 'محتوای نامناسب در استوری' })
      .expect(201);
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.storyId).toBe(storyId);
    expect(res.body.reviewId).toBeNull();
    expect(res.body.portfolioItemId).toBeNull();
    expect(res.body.targetType).toBe('story');

    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item).toBeDefined();
    expect(item.storyId).toBe(storyId);
    expect(item.targetType).toBe('story');
    expect(item.storyUrl).toBe('http://x/uploads/story.jpg');
    expect(item.storyCaption).toBe('کوتاهی مو');
    expect(item.portfolioItemUrl).toBeNull();
    expect(item.portfolioItemCaption).toBeNull();

    // The rebuilt dedup index keys COALESCE-per-target: a second open report on the
    // SAME story from the same reporter still collides (409)…
    await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ storyId, reason: 'گزارش تکراری برای همین استوری' })
      .expect(409);
  });

  it('allows coexisting open reports on different targets at the same salon (rebuilt dedup index)', async () => {
    // …while a portfolio report from the same reporter at the same salon — alongside
    // the still-open story report — inserts cleanly instead of colliding on salon_id.
    const ds = app.get(DataSource);
    const [{ id: portfolioItemId }] = await ds.query(
      `INSERT INTO portfolio_items (salon_id, url, storage_key, caption)
       VALUES ($1, 'http://x/uploads/work.jpg', 'salons/x/portfolio/a.jpg', 'نمونه رنگ مو')
       RETURNING id`,
      [salonId],
    );

    const res = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ portfolioItemId, reason: 'محتوای نامناسب در نمونه کار' })
      .expect(201);
    expect(res.body.salonId).toBe(salonId);
    expect(res.body.portfolioItemId).toBe(portfolioItemId);
    expect(res.body.storyId).toBeNull();
    expect(res.body.targetType).toBe('portfolio');

    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item.portfolioItemUrl).toBe('http://x/uploads/work.jpg');
    expect(item.portfolioItemCaption).toBe('نمونه رنگ مو');
    expect(item.storyUrl).toBeNull();
  });

  it('400s a report naming both a story and a portfolio item', () =>
    request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({
        storyId: '00000000-0000-4000-8000-000000000098',
        portfolioItemId: '00000000-0000-4000-8000-000000000097',
        reason: 'هر دو هدف با هم',
      })
      .expect(400));

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
    expect(res.body.targetType).toBe('review');

    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === res.body.id);
    expect(item).toBeDefined();
    expect(item.reviewRating).toBe(1);
    expect(item.reviewComment).toBe('توهین‌آمیز');
  });

  // ---- SET NULL cascade vs open-report dedup index (regression: provider deletes) ----

  it('provider deletes a reported story while the same reporter holds an open salon report — 204, report survives as an orphaned story report', async () => {
    // The reporter's original salon report was resolved above, so a fresh open
    // salon-target report — signature (reporter, salon, 0, 0, 0) — inserts cleanly.
    await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ salonId, reason: 'گزارش تازه درباره خود سالن' })
      .expect(201);

    // Deleting the reported story FK-nulls reports.story_id. Under an index without
    // the orphaned-content exclusion, the nulled tuple would collide with the open
    // salon report above and Postgres would abort the DELETE with 23505 (a 500).
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/stories/${reportedStoryId}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    // The report row survives: reason kept, story_id nulled, and target_type still
    // says 'story' — the only remaining discriminator after the cascade.
    const list = await request(app.getHttpServer()).get('/api/admin/reports').set('Cookie', adminCookie).expect(200);
    const orphan = list.body.items.find(
      (i: { reason: string }) => i.reason === 'محتوای نامناسب در استوری',
    );
    expect(orphan).toBeDefined();
    expect(orphan.status).toBe('open');
    expect(orphan.storyId).toBeNull();
    expect(orphan.storyUrl).toBeNull();
    expect(orphan.targetType).toBe('story');
  });

  it('deleting two reported stories sequentially succeeds — both orphaned reports collapse to identical null signatures', async () => {
    const ds = app.get(DataSource);
    const rows: { id: string }[] = await ds.query(
      `INSERT INTO salon_stories (salon_id, url, storage_key, expires_at)
       SELECT $1, 'http://x/uploads/s' || g || '.jpg', 'salons/x/stories/s' || g || '.jpg', now() + interval '24 hours'
       FROM generate_series(1, 2) g
       RETURNING id`,
      [salonId],
    );
    const [storyOne, storyTwo] = rows.map((r) => r.id);

    const reportOne = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ storyId: storyOne, reason: 'استوری اول نامناسب است' })
      .expect(201);
    const reportTwo = await request(app.getHttpServer())
      .post('/api/reports')
      .set('Cookie', customerCookie)
      .send({ storyId: storyTwo, reason: 'استوری دوم نامناسب است' })
      .expect(201);

    // First delete orphans reportOne to (reporter, salon, 0, 0, 0); the second delete
    // would produce an IDENTICAL tuple for reportTwo — only the target_type exclusion
    // in reports_open_target_uidx keeps both cascades (and the salon report from the
    // previous test) from colliding.
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/stories/${storyOne}`)
      .set('Cookie', ownerCookie)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/stories/${storyTwo}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    const surviving = await ds.query(
      `SELECT story_id, target_type, status FROM reports WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [[reportOne.body.id, reportTwo.body.id]],
    );
    expect(surviving).toHaveLength(2);
    for (const row of surviving) {
      expect(row.story_id).toBeNull();
      expect(row.target_type).toBe('story');
      expect(row.status).toBe('open');
    }
  });
});
