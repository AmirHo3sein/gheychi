import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin categories (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122280001');
  });

  afterAll(async () => {
    await app.close();
  });

  let categoryId: number;

  it('creates a category', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ عروس', icon: '💄' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'میکاپ عروس', icon: '💄' });
    categoryId = res.body.id;
  });

  it('rejects a duplicate name', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ عروس', icon: '💄' })
      .expect(409);
  });

  it('renames a category', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ و شینیون عروس' })
      .expect(200);
    expect(res.body.name).toBe('میکاپ و شینیون عروس');
  });

  it('404s an unknown category id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/categories/999999')
      .set('Cookie', adminCookie)
      .send({ name: 'x' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122280099');
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', customerCookie)
      .send({ name: 'x', icon: 'x' })
      .expect(403);
  });

  it('confirms the public GET /categories reflects the change', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(res.body.find((c: { id: number }) => c.id === categoryId).name).toBe('میکاپ و شینیون عروس');
  });

  it('rejects a name longer than the varchar(60) column width with 400, not 500', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'a'.repeat(61), icon: 'x' })
      .expect(400);
  });

  it('rejects renaming a category to another category\'s existing name with 409, not 500', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'CategoryA', icon: 'x' })
      .expect(201);
    const b = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'CategoryB', icon: 'x' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${b.body.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'CategoryA' })
      .expect(409);
  });
});
