import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin users list and suspend (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerUserId: string;
  let adminUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122300001');
    await loginAs(app, '09122300002');

    const me = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122300002')
      .set('Cookie', adminCookie)
      .expect(200);
    customerUserId = me.body.items[0].id;

    const self = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122300001')
      .set('Cookie', adminCookie)
      .expect(200);
    adminUserId = self.body.items[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('filters by phone', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122300002')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].phone).toBe('09122300002');
  });

  it('filters by role', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?role=admin')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items.some((u: { phone: string }) => u.phone === '09122300001')).toBe(true);
    expect(res.body.items.some((u: { phone: string }) => u.phone === '09122300002')).toBe(false);
  });

  it('paginates the results', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?page=1&pageSize=1')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('suspends a user', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${customerUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(200);
    expect(res.body.status).toBe('suspended');
  });

  it('reactivates a suspended user', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${customerUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
      .expect(200);
    expect(res.body.status).toBe('active');
  });

  it('404s an unknown user id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/users/00000000-0000-0000-0000-000000000000/status')
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122300099');
    await request(app.getHttpServer()).get('/api/admin/users').set('Cookie', customerCookie).expect(403);
  });

  it('rejects an admin changing their own status', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${adminUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(400);
  });

  it('sorts by phone in either direction; nameless accounts sort after named ones', async () => {
    const list = async (query: string) =>
      (await request(app.getHttpServer()).get(`/api/admin/users?${query}`).set('Cookie', adminCookie).expect(200)).body.items as Array<{
        phone: string;
        name: string | null;
      }>;
    const asc = (await list('sort=phone&order=asc')).map((u) => u.phone);
    expect(asc).toEqual([...asc].sort());
    expect((await list('sort=phone&order=desc')).map((u) => u.phone)).toEqual([...asc].reverse());

    const ds = app.get(DataSource);
    await ds.query(`UPDATE users SET name = 'آ' WHERE phone = '09122300002'`);
    for (const order of ['asc', 'desc']) {
      const names = (await list(`sort=name&order=${order}`)).map((u) => u.name);
      expect(names[0]).toBe('آ');
      expect(names.slice(1).every((n) => n === null)).toBe(true);
    }
    await request(app.getHttpServer()).get('/api/admin/users?sort=role').set('Cookie', adminCookie).expect(400);
  });
});
