import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin notifications endpoints (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122260001');
    customerCookie = await loginAs(app, '09122260002');

    const ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO admin_notifications (type, title, created_at)
       VALUES ('report_created', 'اعلان قدیمی', now() - interval '1 hour')`,
    );
    await ds.query(
      `INSERT INTO admin_notifications (type, title, body, link)
       VALUES ('salon_resubmitted', 'اعلان جدید', 'متن اعلان', '/salons/abc')`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated and non-admin callers', async () => {
    await request(app.getHttpServer()).get('/api/admin/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', customerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', customerCookie)
      .expect(403);
  });

  it('lists notifications newest-first in the standard envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].title).toBe('اعلان جدید');
    expect(res.body.items[0].body).toBe('متن اعلان');
    expect(res.body.items[0].link).toBe('/salons/abc');
    expect(res.body.items[0].readAt).toBeNull();
    expect(res.body.items[1].title).toBe('اعلان قدیمی');
  });

  it('counts unread and supports the unread filter, read, and read-all idempotently', async () => {
    const count1 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count1.body).toEqual({ count: 2 });

    const unreadList = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(unreadList.body.total).toBe(2);
    const newestId = unreadList.body.items[0].id;

    const read = await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${newestId}/read`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(read.body.readAt).not.toBeNull();

    // second read of the same row is a no-op, not an error
    await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${newestId}/read`)
      .set('Cookie', adminCookie)
      .expect(200);

    const count2 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count2.body).toEqual({ count: 1 });

    const unreadAfter = await request(app.getHttpServer())
      .get('/api/admin/notifications?unread=true')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(unreadAfter.body.total).toBe(1);
    expect(unreadAfter.body.items[0].title).toBe('اعلان قدیمی');

    await request(app.getHttpServer())
      .patch('/api/admin/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Cookie', adminCookie)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/admin/notifications/read-all')
      .set('Cookie', adminCookie)
      .expect(200);
    const count3 = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(count3.body).toEqual({ count: 0 });

    // read-all with nothing unread is also a no-op
    await request(app.getHttpServer())
      .post('/api/admin/notifications/read-all')
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it("one admin's read state never leaks into another admin's view (per-caller read state)", async () => {
    const secondAdminCookie = await loginAsAdmin(app, '09122260003');

    const res = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', secondAdminCookie)
      .expect(200);
    // The first admin already read everything in the previous test -- a fresh admin
    // must still see every notification as unread, proving read state isn't shared.
    expect(res.body.items.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);

    const count = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', secondAdminCookie)
      .expect(200);
    expect(count.body.count).toBe(res.body.items.length);

    const targetId = res.body.items[0].id;
    await request(app.getHttpServer())
      .patch(`/api/admin/notifications/${targetId}/read`)
      .set('Cookie', secondAdminCookie)
      .expect(200);

    // The first admin's own (already-all-read) view is untouched by the second
    // admin's read just now.
    const firstAdminCount = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(firstAdminCount.body.count).toBe(0);

    // ...and the second admin's own count reflects exactly the one they just read.
    const secondAdminCount = await request(app.getHttpServer())
      .get('/api/admin/notifications/unread-count')
      .set('Cookie', secondAdminCookie)
      .expect(200);
    expect(secondAdminCount.body.count).toBe(res.body.items.length - 1);
  });

  describe('type/severity filters and unread-counts', () => {
    let filterAdminCookie: string;

    beforeAll(async () => {
      // A fresh admin, so every row below is unread for them regardless of earlier tests.
      filterAdminCookie = await loginAsAdmin(app, '09122260004');
      const ds = app.get(DataSource);
      await ds.query(
        `INSERT INTO admin_notifications (type, title, severity) VALUES
           ('alert', 'هشدار بحرانی', 'critical'),
           ('alert', 'هشدار عادی', 'warning'),
           ('alert', 'هشدار قدیمی بدون شدت', NULL)`,
      );
    });

    it('rejects unknown type/severity values with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/notifications?type=nope')
        .set('Cookie', filterAdminCookie)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=urgent')
        .set('Cookie', filterAdminCookie)
        .expect(400);
    });

    it('filters by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/notifications?type=report_created')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].title).toBe('اعلان قدیمی');
      expect(res.body.items[0].type).toBe('report_created');
    });

    it('filters by displayed severity -- a NULL-severity alert matches warning, never critical', async () => {
      const warning = await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=warning')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(warning.body.total).toBe(2);
      expect(warning.body.items.map((n: { title: string }) => n.title).sort()).toEqual(
        ['هشدار عادی', 'هشدار قدیمی بدون شدت'].sort(),
      );
      expect(warning.body.items.every((n: { severity: string }) => n.severity === 'warning')).toBe(true);

      const critical = await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=critical&type=alert')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(critical.body.total).toBe(1);
      expect(critical.body.items[0].title).toBe('هشدار بحرانی');

      const info = await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=info')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(info.body.total).toBe(2);
      expect(info.body.items.every((n: { type: string }) => n.type !== 'alert')).toBe(true);
    });

    it('returns per-severity unread counts for the caller, and enforces the admin role', async () => {
      await request(app.getHttpServer()).get('/api/admin/notifications/unread-counts').expect(401);
      await request(app.getHttpServer())
        .get('/api/admin/notifications/unread-counts')
        .set('Cookie', customerCookie)
        .expect(403);

      const before = await request(app.getHttpServer())
        .get('/api/admin/notifications/unread-counts')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(before.body).toEqual({ total: 5, critical: 1, warning: 2, info: 2 });

      const critical = await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=critical')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/admin/notifications/${critical.body.items[0].id}/read`)
        .set('Cookie', filterAdminCookie)
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/api/admin/notifications/unread-counts')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(after.body).toEqual({ total: 4, critical: 0, warning: 2, info: 2 });

      // unread=true composes with the filters
      const unreadCritical = await request(app.getHttpServer())
        .get('/api/admin/notifications?severity=critical&unread=true')
        .set('Cookie', filterAdminCookie)
        .expect(200);
      expect(unreadCritical.body.total).toBe(0);
    });
  });
});
