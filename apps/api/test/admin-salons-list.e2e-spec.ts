import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon list filters (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let tehranSalonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122230001');

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;

    const ownerCookie = await loginAs(app, '09122230002');
    const tehranRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Pending Salon Tehran',
      genderTarget: 'women',
      address: 'Somewhere St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      categoryIds: [categoryId],
    });
    tehranSalonId = tehranRes.body.id;

    const owner2Cookie = await loginAs(app, '09122230003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', owner2Cookie).send({
      name: 'Pending Salon Shiraz',
      genderTarget: 'men',
      address: 'Somewhere St, No. 6',
      city: 'Shiraz',
      lat: 29.6,
      lng: 52.5,
      categoryIds: [categoryId],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to status=pending when no filter is given', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.items.every((s: { status: string }) => s.status === 'pending')).toBe(true);
  });

  it('orders the default pending queue oldest-createdAt-first, not alphabetically by name', async () => {
    // Tehran was created before Shiraz in beforeAll, so createdAt-ASC puts Tehran
    // first -- the opposite of the old name-ASC order, which put Shiraz first.
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items.map((s: { name: string }) => s.name)).toEqual([
      'Pending Salon Tehran',
      'Pending Salon Shiraz',
    ]);
    const createdAts = res.body.items.map((s: { createdAt: string }) => new Date(s.createdAt).getTime());
    expect(createdAts[0]).toBeLessThanOrEqual(createdAts[1]);
  });

  it('filters by city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?city=Shiraz')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by genderTarget', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?genderTarget=men')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by name (partial, case-insensitive)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?name=tehran')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Pending Salon Tehran');
  });

  it('an explicit status=approved filter overrides the pending default', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('status=all returns every status with no filtering', async () => {
    // Approve one of the two seeded salons so this request must span both
    // 'pending' and 'approved' statuses -- proving the 'all' bypass genuinely
    // disables the pending-only default, rather than the assertion happening
    // to pass because both seeded salons are still pending.
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${tehranSalonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const byName = (name: string) => res.body.items.find((s: { name: string }) => s.name === name);
    expect(byName('Pending Salon Tehran')?.status).toBe('approved');
    expect(byName('Pending Salon Shiraz')?.status).toBe('pending');
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122230004');
    await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', customerCookie)
      .expect(403);
  });

  it('paginates results and reports the true total across all pages', async () => {
    // Approve both seeded salons (Tehran was already approved by the previous test;
    // Shiraz still needs to be) so status=all + pageSize=1 has two real pages to walk.
    await request(app.getHttpServer())
      .get('/api/admin/salons?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const shirazId = (
      await request(app.getHttpServer()).get('/api/admin/salons?status=all').set('Cookie', adminCookie)
    ).body.items.find((s: { name: string }) => s.name === 'Pending Salon Shiraz').id;
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${shirazId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const page1 = await request(app.getHttpServer())
      .get('/api/admin/salons?status=all&page=1&pageSize=1')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.total).toBe(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(1);

    const page2 = await request(app.getHttpServer())
      .get('/api/admin/salons?status=all&page=2&pageSize=1')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(2);
    // The two pages, taken together, must cover both salons with no overlap --
    // proving skip/take is genuinely wired to `page`, not just accepting and
    // ignoring the query params.
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
  });
});
