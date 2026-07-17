import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { StoryCleanupJob } from '../src/salons/story-cleanup.job';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// A minimal valid 1x1 transparent PNG (real magic-number bytes, not fake/placeholder
// content) -- needed because NestJS's FileTypeValidator does real magic-number sniffing
// via the `file-type` package, not a pure mimetype-string check.
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Salon showcase: stories, portfolio, profile (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ownerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let slug: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    dataSource = app.get(DataSource);
    ownerCookie = await loginAs(app, '09166600001');
    adminCookie = await loginAsAdmin(app, '09166600002');

    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Showcase Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 11',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = salonRes.body.id;
    slug = salonRes.body.slug;

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Showcase Haircut', price: 500000, durationMin: 30 })
      .expect(201);
    serviceId = serviceRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const uploadStory = (fields: Record<string, string> = {}) => {
    let req = request(app.getHttpServer())
      .post('/api/salons/mine/stories')
      .set('Cookie', ownerCookie);
    for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
    return req.attach('file', MINIMAL_PNG, { filename: 'story.jpg', contentType: 'image/jpeg' });
  };

  const uploadPortfolioItem = (fields: Record<string, string> = {}) => {
    let req = request(app.getHttpServer())
      .post('/api/salons/mine/portfolio')
      .set('Cookie', ownerCookie);
    for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
    return req.attach('file', MINIMAL_PNG, { filename: 'work.jpg', contentType: 'image/jpeg' });
  };

  // ---------------------------------------------------------------- stories

  let storyAId: string;
  let storyBId: string;

  it('rejects unauthenticated access to the provider stories endpoint', () =>
    request(app.getHttpServer()).get('/api/salons/mine/stories').expect(401));

  it('uploads a story with caption and service link, stamped with a 24h DB-clock TTL', async () => {
    const res = await uploadStory({ caption: 'استوری اول', serviceId }).expect(201);
    storyAId = res.body.id;
    expect(res.body.url).toContain(`/uploads/salons/${salonId}/stories/`);
    expect(res.body.status).toBe('published');
    expect(res.body.caption).toBe('استوری اول');
    expect(res.body.serviceId).toBe(serviceId);
    const ttlMs = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23.5 * 3_600_000);
    expect(ttlMs).toBeLessThan(24.5 * 3_600_000);
  });

  it('rejects a non-image story upload', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/stories')
      .set('Cookie', ownerCookie)
      .attach('file', Buffer.from('not an image'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(422));

  it('rejects an over-length multipart caption with 400 (DTO validation reaches multipart text fields)', () =>
    uploadStory({ caption: 'ن'.repeat(201) }).expect(400));

  it('rejects a serviceId that does not belong to the caller salon', () =>
    uploadStory({ serviceId: '3f8a72fe-0000-4000-8000-000000000009' }).expect(400));

  it('404s the public stories endpoint while the salon is still pending', () =>
    request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(404));

  it('exposes published stories publicly (exact field shape) once the salon is approved', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ id: storyAId, caption: 'استوری اول', serviceId });
    expect(res.body[0].url).toContain('/uploads/');
    expect(res.body[0].createdAt).toBeDefined();
    expect(res.body[0].expiresAt).toBeDefined();
    expect(res.body[0]).not.toHaveProperty('storageKey');
    expect(res.body[0]).not.toHaveProperty('status');
    expect(res.body[0]).not.toHaveProperty('salonId');
  });

  it('keeps a removed story in the provider list (badge) but off the public list', async () => {
    await dataSource.query(`UPDATE salon_stories SET status = 'removed' WHERE id = $1`, [storyAId]);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/stories')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.length).toBe(1);
    expect(mine.body[0].status).toBe('removed');

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(publicRes.body.length).toBe(0);
  });

  it('enforces the 10-active-story cap, counting removed-but-unexpired stories', async () => {
    // storyA is 'removed' but unexpired, so it still occupies slot 1 of 10.
    for (let i = 0; i < 9; i++) {
      await uploadStory({ caption: `استوری ${i + 2}` }).expect(201);
    }
    const res = await uploadStory().expect(409);
    expect(res.body.message).toBe('حداکثر ۱۰ استوری فعال مجاز است');
  });

  it('frees a cap slot when the owner deletes a story', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/stories/${storyAId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
    const res = await uploadStory({ caption: 'استوری تازه' }).expect(201);
    storyBId = res.body.id;
  });

  it('hides an expired story from both the provider and public lists via the read-time filter', async () => {
    await dataSource.query(`UPDATE salon_stories SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      storyBId,
    ]);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/stories')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.map((s: { id: string }) => s.id)).not.toContain(storyBId);

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(publicRes.body.map((s: { id: string }) => s.id)).not.toContain(storyBId);
  });

  it('cleanup job: grace hour spares a just-expired story', async () => {
    const deleted = await app.get(StoryCleanupJob).run();
    expect(deleted).toBe(0);
    const rows = await dataSource.query(`SELECT id FROM salon_stories WHERE id = $1`, [storyBId]);
    expect(rows.length).toBe(1);
  });

  it('cleanup job: an open report pins the evidence; resolving it releases the row', async () => {
    await dataSource.query(`UPDATE salon_stories SET expires_at = now() - interval '2 hours' WHERE id = $1`, [
      storyBId,
    ]);
    const [{ id: reporterId }] = await dataSource.query(`SELECT id FROM users WHERE phone = '09166600002'`);
    await dataSource.query(
      `INSERT INTO reports (reporter_id, salon_id, story_id, target_type, reason) VALUES ($1, $2, $3, 'story', 'محتوای نامناسب در استوری')`,
      [reporterId, salonId, storyBId],
    );

    expect(await app.get(StoryCleanupJob).run()).toBe(0);
    expect((await dataSource.query(`SELECT id FROM salon_stories WHERE id = $1`, [storyBId])).length).toBe(1);

    await dataSource.query(`UPDATE reports SET status = 'resolved' WHERE story_id = $1`, [storyBId]);

    expect(await app.get(StoryCleanupJob).run()).toBe(1);
    expect((await dataSource.query(`SELECT id FROM salon_stories WHERE id = $1`, [storyBId])).length).toBe(0);
    // ON DELETE SET NULL keeps the report row (reason text survives) with a null target.
    const reports = await dataSource.query(`SELECT story_id FROM reports WHERE salon_id = $1`, [salonId]);
    expect(reports.length).toBe(1);
    expect(reports[0].story_id).toBeNull();
  });

  // -------------------------------------------------------------- portfolio

  let itemAId: string;
  let itemBId: string;

  it('uploads portfolio items appended at the next sort_order', async () => {
    const first = await uploadPortfolioItem({ caption: 'نمونه کار اول', serviceId }).expect(201);
    itemAId = first.body.id;
    expect(first.body.url).toContain(`/uploads/salons/${salonId}/portfolio/`);
    expect(first.body.sortOrder).toBe(0);
    expect(first.body.status).toBe('published');

    const second = await uploadPortfolioItem({ caption: 'نمونه کار دوم' }).expect(201);
    itemBId = second.body.id;
    expect(second.body.sortOrder).toBe(1);
  });

  it('rejects an over-length portfolio caption with 400', () =>
    uploadPortfolioItem({ caption: 'ن'.repeat(301) }).expect(400));

  it('rejects a portfolio serviceId that does not belong to the caller salon', () =>
    uploadPortfolioItem({ serviceId: '3f8a72fe-0000-4000-8000-000000000009' }).expect(400));

  it('exposes published portfolio items publicly in sort order (exact field shape)', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/portfolio`).expect(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toMatchObject({ id: itemAId, caption: 'نمونه کار اول', serviceId, sortOrder: 0 });
    expect(res.body[1]).toMatchObject({ id: itemBId, sortOrder: 1 });
    expect(res.body[0]).not.toHaveProperty('storageKey');
    expect(res.body[0]).not.toHaveProperty('status');
    expect(res.body[0]).not.toHaveProperty('salonId');
  });

  it('edits caption/sortOrder and clears the service link via PATCH', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/portfolio/${itemAId}`)
      .set('Cookie', ownerCookie)
      .send({ caption: 'نمونه کار ویرایش‌شده', sortOrder: 5 })
      .expect(200);
    expect(res.body.caption).toBe('نمونه کار ویرایش‌شده');
    expect(res.body.sortOrder).toBe(5);

    const cleared = await request(app.getHttpServer())
      .patch(`/api/salons/mine/portfolio/${itemAId}`)
      .set('Cookie', ownerCookie)
      .send({ serviceId: null })
      .expect(200);
    expect(cleared.body.serviceId).toBeNull();
  });

  it('404s a PATCH for an unknown portfolio item', () =>
    request(app.getHttpServer())
      .patch('/api/salons/mine/portfolio/3f8a72fe-0000-4000-8000-000000000009')
      .set('Cookie', ownerCookie)
      .send({ sortOrder: 1 })
      .expect(404));

  it('keeps a removed portfolio item in the provider list but off the public list', async () => {
    await dataSource.query(`UPDATE portfolio_items SET status = 'removed' WHERE id = $1`, [itemBId]);

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/portfolio`).expect(200);
    expect(publicRes.body.map((i: { id: string }) => i.id)).not.toContain(itemBId);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/portfolio')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.length).toBe(2);
    expect(mine.body.find((i: { id: string }) => i.id === itemBId).status).toBe('removed');
  });

  it('enforces the 40-item portfolio cap with the exact Persian message', async () => {
    // Fill from 2 rows up to the cap directly -- 38 real uploads would add nothing here.
    await dataSource.query(
      `INSERT INTO portfolio_items (salon_id, url, storage_key)
       SELECT $1, 'http://x/uploads/filler.jpg', 'salons/filler/' || g FROM generate_series(1, 38) g`,
      [salonId],
    );
    const res = await uploadPortfolioItem().expect(409);
    expect(res.body.message).toBe('حداکثر ۴۰ نمونه کار مجاز است');
  });

  it('deletes a portfolio item', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/portfolio/${itemBId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/portfolio')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.map((i: { id: string }) => i.id)).not.toContain(itemBId);
  });

  // ---------------------------------------------------------------- profile

  it('saves tagline/about/instagramHandle through the existing salon PATCH and serves them publicly', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ tagline: 'زیبایی با ما', about: 'سالنی برای شما\nبا بهترین خدمات', instagramHandle: 'My_Salon.ir' })
      .expect(200);
    expect(res.body.tagline).toBe('زیبایی با ما');
    expect(res.body.about).toBe('سالنی برای شما\nبا بهترین خدمات');
    expect(res.body.instagramHandle).toBe('My_Salon.ir');

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}`).expect(200);
    expect(publicRes.body.tagline).toBe('زیبایی با ما');
    expect(publicRes.body.about).toBe('سالنی برای شما\nبا بهترین خدمات');
    expect(publicRes.body.instagramHandle).toBe('My_Salon.ir');
  });

  it('clears profile fields when an empty string is sent', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ tagline: '', instagramHandle: '' })
      .expect(200);
    expect(res.body.tagline).toBeNull();
    expect(res.body.instagramHandle).toBeNull();
    expect(res.body.about).toBe('سالنی برای شما\nبا بهترین خدمات');
  });

  it('rejects an instagram handle outside the safe charset and an over-length tagline', async () => {
    await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ instagramHandle: 'bad handle!' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ tagline: 'ن'.repeat(121) })
      .expect(400);
  });

  // ------------------------------------------------------- admin moderation

  let expiredStoryId: string;
  let modStoryId: string;

  it('403s the admin showcase endpoints for a non-admin caller', async () => {
    await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}/stories`)
      .set('Cookie', ownerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/admin/stories/00000000-0000-4000-8000-000000000001/status')
      .set('Cookie', ownerCookie)
      .send({ status: 'removed' })
      .expect(403);
  });

  it('admin story list includes expired rows the provider and public lists no longer show', async () => {
    // At this point 9 unexpired published stories remain (cap test uploads minus the
    // cleanup-collected one). Add an expired row directly -- only admins may still see it.
    const [{ id }] = await dataSource.query(
      `INSERT INTO salon_stories (salon_id, url, storage_key, expires_at)
       VALUES ($1, 'http://x/uploads/expired.jpg', 'salons/x/stories/expired.jpg', now() - interval '10 minutes')
       RETURNING id`,
      [salonId],
    );
    expiredStoryId = id;

    const adminList = await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}/stories`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(adminList.body.length).toBe(10);
    expect(adminList.body.map((s: { id: string }) => s.id)).toContain(expiredStoryId);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/stories')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.length).toBe(9);
    expect(mine.body.map((s: { id: string }) => s.id)).not.toContain(expiredStoryId);
  });

  it('admin portfolio list includes removed rows; 404s for an unknown salon', async () => {
    const adminList = await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}/portfolio`)
      .set('Cookie', adminCookie)
      .expect(200);
    // itemA + 38 fillers survive (itemB was deleted while status='removed' earlier).
    expect(adminList.body.length).toBe(39);
    expect(adminList.body.map((i: { id: string }) => i.id)).toContain(itemAId);

    await request(app.getHttpServer())
      .get('/api/admin/salons/00000000-0000-4000-8000-000000000000/stories')
      .set('Cookie', adminCookie)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/admin/salons/00000000-0000-4000-8000-000000000000/portfolio')
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('admin removes a story: hidden from the public list, badge-visible to the provider', async () => {
    const publicBefore = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(publicBefore.body.length).toBe(9);
    modStoryId = publicBefore.body[0].id;

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/stories/${modStoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'removed', reason: 'محتوای نامناسب' })
      .expect(200);
    expect(res.body.status).toBe('removed');

    const publicAfter = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(publicAfter.body.map((s: { id: string }) => s.id)).not.toContain(modStoryId);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/stories')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(mine.body.find((s: { id: string }) => s.id === modStoryId).status).toBe('removed');
  });

  it('409s a repeat removal (conditional status set, no silent re-apply)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/stories/${modStoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'removed' })
      .expect(409);
    expect(res.body.message).toBe('این مورد قبلاً حذف شده است');
  });

  it('restores the removed story back onto the public list (reversible moderation, no hard delete)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/stories/${modStoryId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    expect(res.body.status).toBe('published');

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/stories`).expect(200);
    expect(publicRes.body.map((s: { id: string }) => s.id)).toContain(modStoryId);
  });

  it('admin removes and restores a portfolio item through the same toggle', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/portfolio/${itemAId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'removed', reason: 'گزارش مشتری' })
      .expect(200);

    const publicRes = await request(app.getHttpServer()).get(`/api/salons/${slug}/portfolio`).expect(200);
    expect(publicRes.body.map((i: { id: string }) => i.id)).not.toContain(itemAId);

    await request(app.getHttpServer())
      .patch(`/api/admin/portfolio/${itemAId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);

    const restore = await request(app.getHttpServer())
      .patch(`/api/admin/portfolio/${itemAId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(409);
    expect(restore.body.message).toBe('این مورد در حال حاضر منتشر است');
  });

  it('wrote an audit row per moderation attempt, including the failed 409s', async () => {
    const rows: { action: string; target_type: string; target_id: string; success: boolean }[] =
      await dataSource.query(
        `SELECT action, target_type, target_id, success FROM audit_log
         WHERE action IN ('salon.story.status.set', 'salon.portfolio.status.set')`,
      );
    // Exact multiset -- resetDatabase() in beforeAll makes this file the schema's sole
    // writer, same as the blog e2e's audit assertion.
    expect(rows.map((r) => `${r.action}|${r.success}`).sort()).toEqual([
      'salon.portfolio.status.set|false',
      'salon.portfolio.status.set|true',
      'salon.portfolio.status.set|true',
      'salon.story.status.set|false',
      'salon.story.status.set|true',
      'salon.story.status.set|true',
    ]);
    const storyRows = rows.filter((r) => r.action === 'salon.story.status.set');
    expect(storyRows.every((r) => r.target_type === 'story' && r.target_id === modStoryId)).toBe(true);
    const portfolioRows = rows.filter((r) => r.action === 'salon.portfolio.status.set');
    expect(portfolioRows.every((r) => r.target_type === 'portfolioitem' && r.target_id === itemAId)).toBe(true);
  });

  // ------------------------------------- portfolio sort_order (delete-then-upload)

  it('delete-then-upload appends at a unique, highest sortOrder (reorder swaps stay effective)', async () => {
    // Isolated scenario: nothing after this test depends on portfolio state.
    await dataSource.query(`DELETE FROM portfolio_items WHERE salon_id = $1`, [salonId]);

    const first = await uploadPortfolioItem({ caption: 'اول' }).expect(201);
    const second = await uploadPortfolioItem({ caption: 'دوم' }).expect(201);
    const third = await uploadPortfolioItem({ caption: 'سوم' }).expect(201);
    expect([first.body.sortOrder, second.body.sortOrder, third.body.sortOrder]).toEqual([0, 1, 2]);

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/portfolio/${first.body.id}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    // Count is now 2 while sortOrders {1, 2} remain: a count-based append would
    // duplicate sortOrder 2 and make the panel's swap-based reorder a no-op for the
    // tied pair. MAX+1 must yield 3 — strictly above every surviving row.
    const fourth = await uploadPortfolioItem({ caption: 'چهارم' }).expect(201);
    expect(fourth.body.sortOrder).toBe(3);

    const mine = await request(app.getHttpServer())
      .get('/api/salons/mine/portfolio')
      .set('Cookie', ownerCookie)
      .expect(200);
    const orders = mine.body.map((i: { sortOrder: number }) => i.sortOrder);
    expect(orders).toEqual([1, 2, 3]);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
