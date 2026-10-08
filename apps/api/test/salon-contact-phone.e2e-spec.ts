import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { firstCategoryId } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const OWNER_PHONE = '09151230001';

describe('Salon public contact phone and material-edit reporting (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let adminCookie: string;
  let categoryId: number;
  let salonId: string;
  let slug: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    ownerCookie = await loginAs(app, OWNER_PHONE);
    adminCookie = await loginAsAdmin(app, '09151230099');
    categoryId = await firstCategoryId(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('creation and update', () => {
    it('stores a normalised contactPhone on creation and returns it on GET /salons/mine', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/salons')
        .set('Cookie', ownerCookie)
        .send({
          name: 'Contact Salon', genderTarget: 'women', address: 'Valiasr St, No. 5', city: 'Tehran',
          lat: 35.7, lng: 51.4, categoryIds: [categoryId], contactPhone: '۰۲۱-۸۸۸۸ ۷۷۷۷',
        })
        .expect(201);
      salonId = created.body.id;
      slug = created.body.slug;
      expect(created.body.contactPhone).toBe('02188887777');

      const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie).expect(200);
      expect(mine.body.contactPhone).toBe('02188887777');
    });

    it('PATCH accepts a mobile number, rejects bad shapes with a Persian 400, and clears with "" or null', async () => {
      const patch = (body: object) =>
        request(app.getHttpServer()).patch('/api/salons/mine').set('Cookie', ownerCookie).send(body);

      const ok = await patch({ contactPhone: '٠٩١٢٣٤٥٦٧٨٩' }).expect(200);
      expect(ok.body.contactPhone).toBe('09123456789');

      for (const bad of ['12345', '+989123456789', '0912345678', 'abc']) {
        const res = await patch({ contactPhone: bad }).expect(400);
        expect(JSON.stringify(res.body.message)).toContain('شماره تماس');
      }
      // A rejected value must not have changed the stored one.
      const still = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie).expect(200);
      expect(still.body.contactPhone).toBe('09123456789');

      await patch({ contactPhone: '' }).expect(200);
      expect((await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie)).body.contactPhone).toBeNull();

      await patch({ contactPhone: '09123456789' }).expect(200);
      await patch({ contactPhone: null }).expect(200);
      expect((await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie)).body.contactPhone).toBeNull();
    });

    it('an unrelated PATCH leaves the stored contactPhone untouched', async () => {
      await request(app.getHttpServer()).patch('/api/salons/mine').set('Cookie', ownerCookie).send({ contactPhone: '09123456789' }).expect(200);
      await request(app.getHttpServer()).patch('/api/salons/mine').set('Cookie', ownerCookie).send({ tagline: 'شعار' }).expect(200);
      const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', ownerCookie).expect(200);
      expect(mine.body.contactPhone).toBe('09123456789');
    });

    it('still ignores the admin-only timeout columns on PATCH /salons/mine', async () => {
      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', ownerCookie)
        .send({ approvalTimeoutMinutes: 3, paymentTimeoutMinutes: 3 })
        .expect((res) => expect([200, 400]).toContain(res.status));
      const [row] = await ds.query(`SELECT approval_timeout_minutes AS a, payment_timeout_minutes AS p FROM salons WHERE id = $1`, [salonId]);
      expect(row).toEqual({ a: null, p: null });
    });
  });

  describe('public exposure', () => {
    it('is NOT public while the salon is pending (404), and nothing about the owner account phone ever is', async () => {
      await request(app.getHttpServer()).get(`/api/salons/${slug}`).expect(404);
    });

    it('is public once approved, with memberSince, and never carries the owner account phone', async () => {
      await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
      const res = await request(app.getHttpServer()).get(`/api/salons/${slug}`).expect(200);

      expect(res.body.contactPhone).toBe('09123456789');
      expect(new Date(res.body.memberSince).toISOString()).toBe(res.body.memberSince);
      expect(JSON.stringify(res.body)).not.toContain(OWNER_PHONE);
      expect(res.body).not.toHaveProperty('approvalTimeoutMinutes');
    });

    it('is absent from search results, favourites-style listings and the sitemap feed', async () => {
      await ds.query(
        `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
        [salonId],
      );
      const search = await request(app.getHttpServer()).get('/api/search').query({ lat: 35.7, lng: 51.4, gender: 'women' }).expect(200);
      const serialised = JSON.stringify(search.body);
      expect(search.body.items.length).toBeGreaterThan(0);
      expect(serialised).not.toContain('09123456789');
      expect(serialised).not.toContain('contactPhone');
      expect(serialised).not.toContain(OWNER_PHONE);

      const sitemap = await request(app.getHttpServer()).get('/api/sitemap/salon-slugs').expect(200);
      expect(JSON.stringify(sitemap.body)).not.toContain('09123456789');
    });
  });

  describe('material edits to an approved salon', () => {
    const unreadMaterialEdits = async () => {
      const res = await request(app.getHttpServer()).get('/api/admin/notifications').query({ pageSize: 100 }).set('Cookie', adminCookie).expect(200);
      return res.body.items.filter((n: { type?: string; title: string }) => n.title.includes('اطلاعات تاییدشده'));
    };

    it('keeps the salon live, raises one admin notification listing field names only, and writes an audit row', async () => {
      const before = (await unreadMaterialEdits()).length;

      await request(app.getHttpServer())
        .patch('/api/salons/mine')
        .set('Cookie', ownerCookie)
        .send({ name: 'Renamed Contact Salon', address: 'A brand new private address 99' })
        .expect(200);

      const [{ status }] = await ds.query(`SELECT status FROM salons WHERE id = $1`, [salonId]);
      expect(status).toBe('approved');
      await request(app.getHttpServer()).get(`/api/salons/${slug}`).expect(200);

      const after = await unreadMaterialEdits();
      expect(after.length).toBe(before + 1);
      const note = after[0];
      expect(note.link).toBe(`/salons/${salonId}`);
      expect(note.body).toContain('نام');
      expect(note.body).toContain('آدرس');
      expect(`${note.title}${note.body}`).not.toContain('brand new private address');

      const [typeRow] = await ds.query(`SELECT type FROM admin_notifications WHERE link = $1 ORDER BY created_at DESC LIMIT 1`, [`/salons/${salonId}`]);
      expect(typeRow.type).toBe('salon_material_edit');

      const audit = await ds.query(`SELECT payload, success FROM audit_log WHERE action = 'salon.material_edit' AND target_id = $1`, [salonId]);
      expect(audit).toHaveLength(1);
      expect(audit[0].payload).toEqual({ fields: ['name', 'address'] });
    });

    it('a non-material edit (tagline, contactPhone) raises nothing', async () => {
      const before = (await unreadMaterialEdits()).length;
      await request(app.getHttpServer()).patch('/api/salons/mine').set('Cookie', ownerCookie).send({ tagline: 'تازه', contactPhone: '09120000000' }).expect(200);
      expect((await unreadMaterialEdits()).length).toBe(before);
    });
  });
});
