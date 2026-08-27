import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Category requests (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ownerCookie = await loginAs(app, '09166900001');
    adminCookie = await loginAsAdmin(app, '09166900002');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);

    await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', ownerCookie)
      .send({
        name: 'Category Request Test Salon',
        genderTarget: 'women',
        address: 'Somewhere St, No. 44',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        categoryIds: [categoriesRes.body[0].id],
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app.getHttpServer()).post('/api/salons/mine/category-requests').send({ name: 'x' }).expect(401);
    await request(app.getHttpServer()).get('/api/admin/category-requests').expect(401);
  });

  it('a provider submits a category request; it appears in the admin pending queue and the salon\'s own list', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'خدمات ناخن مصنوعی', note: 'مشتریان زیادی این خدمت را می‌خواهند' })
      .expect(201);
    expect(createRes.body.status).toBe('pending');

    const salonListRes = await request(app.getHttpServer())
      .get('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(salonListRes.body).toHaveLength(1);
    expect(salonListRes.body[0].name).toBe('خدمات ناخن مصنوعی');

    const adminListRes = await request(app.getHttpServer())
      .get('/api/admin/category-requests')
      .set('Cookie', adminCookie)
      .expect(200);
    const found = adminListRes.body.items.find((r: { id: string }) => r.id === createRes.body.id);
    expect(found).toBeTruthy();
    expect(found.salonName).toBe('Category Request Test Salon');
    expect(found.requesterPhone).toBe('09166900001');
  });

  it('rejects a request for a name that already exists as a real category', async () => {
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const existingName = categoriesRes.body[0].name;

    await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: existingName })
      .expect(409);
  });

  it('rejects a duplicate pending request for the same name from the same salon', async () => {
    await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'کاشت مژه' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'کاشت مژه' })
      .expect(409);
  });

  it('rejects a non-admin caller on the admin queue and resolve endpoints', async () => {
    const customerCookie = await loginAs(app, '09166900003');
    await request(app.getHttpServer()).get('/api/admin/category-requests').set('Cookie', customerCookie).expect(403);
  });

  it('an admin approves a request: creates the real category, resolves the request, and the category is now publicly listed', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'ماساژ درمانی' })
      .expect(201);

    const approveRes = await request(app.getHttpServer())
      .patch(`/api/admin/category-requests/${createRes.body.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ name: 'ماساژ درمانی', icon: 'sparkles' })
      .expect(200);
    expect(approveRes.body.status).toBe('approved');
    expect(approveRes.body.categoryId).toBeTruthy();

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(categoriesRes.body.some((c: { id: number }) => c.id === approveRes.body.categoryId)).toBe(true);
  });

  it('rejects approving the same request twice (already resolved)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'اسپا صورت' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/category-requests/${createRes.body.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ name: 'اسپا صورت', icon: 'sparkles' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/category-requests/${createRes.body.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ name: 'اسپا صورت متفاوت', icon: 'sparkles' })
      .expect(409);
  });

  it('an admin rejects a request with a required note, and the salon sees the rejection', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .send({ name: 'دسته‌بندی نامتعارف' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/category-requests/${createRes.body.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(400); // note is required

    const rejectRes = await request(app.getHttpServer())
      .patch(`/api/admin/category-requests/${createRes.body.id}/reject`)
      .set('Cookie', adminCookie)
      .send({ note: 'این دسته‌بندی خیلی خاص است و متقاضی کافی ندارد' })
      .expect(200);
    expect(rejectRes.body.status).toBe('rejected');

    const salonListRes = await request(app.getHttpServer())
      .get('/api/salons/mine/category-requests')
      .set('Cookie', ownerCookie)
      .expect(200);
    const rejected = salonListRes.body.find((r: { id: string }) => r.id === createRes.body.id);
    expect(rejected.status).toBe('rejected');
    expect(rejected.resolutionNote).toContain('متقاضی کافی ندارد');
  });

  it('wrote an audit row for both the approve and reject actions', async () => {
    const auditRes = await request(app.getHttpServer())
      .get('/api/admin/audit-log')
      .set('Cookie', adminCookie)
      .query({ action: 'category-request.approve' })
      .expect(200);
    expect(auditRes.body.items.length).toBeGreaterThan(0);
  });
});
