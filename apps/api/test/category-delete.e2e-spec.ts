import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin category delete (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let ownerCookie: string;
  let unusedCategoryId: number;
  let usedCategoryId: number;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09127770001');

    // one deletable category, one that a salon service will reference
    const unused = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'دسته بدون استفاده', icon: 'scissors' })
      .expect(201);
    unusedCategoryId = unused.body.id;

    const used = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'دسته در حال استفاده', icon: 'scissors' })
      .expect(201);
    usedCategoryId = used.body.id;

    ownerCookie = await loginAs(app, '09127770002');
    await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'سالن تست دسته',
        genderTarget: 'women',
        address: 'خیابان ولیعصر، پلاک ۱۲',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        categoryIds: [usedCategoryId],
      })
      .expect(201);

    const service = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: usedCategoryId, name: 'کوتاهی مو', price: 350000, durationMin: 45 })
      .expect(201);
    serviceId = service.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects non-admin callers', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', ownerCookie)
      .expect(403);
  });

  it('409s for a category referenced by a service, with the Farsi message', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/categories/${usedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(409);
    expect(res.body.message).toBe('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست');
  });

  it('still 409s when the referencing service is only soft-deleted (is_active=false)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', ownerCookie)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${usedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('204s for an unused category and removes it from the public list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(204);

    const list = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(list.body.some((c: { id: number }) => c.id === unusedCategoryId)).toBe(false);
  });

  it('404s for an already-deleted category', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/categories/${unusedCategoryId}`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('wrote category.delete audit rows for every admin attempt above', async () => {
    // Task 6's read endpoint doesn't exist yet — query the table directly.
    // AuditInterceptor awaits the insert before the response, so no polling is needed.
    const ds = app.get(DataSource);
    const rows: Array<{ target_id: string; success: boolean }> = await ds.query(
      `SELECT target_id, success FROM audit_log WHERE action = 'category.delete' ORDER BY created_at`,
    );

    // 409, soft-deleted 409, 204, 404 — the non-admin 403 is rejected by the guard
    // before the interceptor runs, so it writes no row.
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.success)).toHaveLength(1);
    expect(rows.filter((r) => r.success)[0].target_id).toBe(String(unusedCategoryId));
  });
});
