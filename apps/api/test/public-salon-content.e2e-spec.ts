import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Public salon content (e2e)', () => {
  let app: INestApplication;
  let slug: string;
  let salonId: string;
  let pendingSlug: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09130000001', 'provider') RETURNING id`,
    );
    slug = 'content-test-salon';
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Content Test Salon', $2, 'women', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)
       RETURNING id`,
      [ownerId, slug],
    );
    salonId = id;
    const [{ id: pendingOwnerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ('09130000002', 'provider') RETURNING id`,
    );
    pendingSlug = 'pending-test-salon';
    await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
       VALUES ($1, 'Pending Test Salon', $2, 'women', 'pending', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography)`,
      [pendingOwnerId, pendingSlug],
    );
    const [{ id: categoryId }] = await ds.query(`SELECT id FROM service_categories LIMIT 1`);
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
       VALUES ($1, $2, 'Haircut', 300000, 30, true), ($1, $2, 'Inactive Service', 100000, 15, false)`,
      [salonId, categoryId],
    );
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) VALUES ($1, 6, '09:00', '18:00')`,
      [salonId],
    );
    await ds.query(
      `INSERT INTO salon_photos (salon_id, url, sort_order, is_cover) VALUES
        ($1, 'https://cdn.example.com/cover.jpg', 0, true),
        ($1, 'https://cdn.example.com/second.jpg', 1, false)`,
      [salonId],
    );
    // One past (must be excluded), one far-future whole-day, one far-future partial-day with
    // a reason -- deliberately far from "now" in both directions so this never becomes
    // flaky as the real calendar date advances.
    await ds.query(
      `INSERT INTO schedule_exceptions (salon_id, date, is_closed) VALUES ($1, '2020-01-01', true)`,
      [salonId],
    );
    await ds.query(
      `INSERT INTO schedule_exceptions (salon_id, date, is_closed) VALUES ($1, '2030-01-01', true)`,
      [salonId],
    );
    await ds.query(
      `INSERT INTO schedule_exceptions (salon_id, date, is_closed, start_time, end_time, reason)
       VALUES ($1, '2030-01-02', true, '13:00', '14:00', 'تعمیرات')`,
      [salonId],
    );
    await ds.destroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists only active services for a salon', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/services`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Haircut');
  });

  it('lists working hours for a salon', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/hours`).expect(200);
    expect(res.body).toEqual([expect.objectContaining({ weekday: 6, openTime: '09:00:00', closeTime: '18:00:00' })]);
  });

  it('lists photos ordered cover-first', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/photos`).expect(200);
    expect(res.body.map((p: { url: string }) => p.url)).toEqual([
      'https://cdn.example.com/cover.jpg',
      'https://cdn.example.com/second.jpg',
    ]);
  });

  it('lists only future-dated exceptions, oldest first, with the internal isClosed flag omitted', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/exceptions`).expect(200);
    expect(res.body).toEqual([
      { date: '2030-01-01', startTime: null, endTime: null, reason: null },
      { date: '2030-01-02', startTime: '13:00:00', endTime: '14:00:00', reason: 'تعمیرات' },
    ]);
    expect(res.body.every((e: object) => !('isClosed' in e))).toBe(true);
  });

  it('404s for an unknown slug on all endpoints', async () => {
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/services').expect(404);
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/hours').expect(404);
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/photos').expect(404);
    await request(app.getHttpServer()).get('/api/salons/does-not-exist/exceptions').expect(404);
  });

  it('lists all approved salon slugs for the sitemap, unfiltered by location', async () => {
    const res = await request(app.getHttpServer()).get('/api/sitemap/salon-slugs').expect(200);
    expect(res.body.items).toContain(slug);
    expect(res.body.page).toBe(1);
  });

  it('excludes non-approved salons from the sitemap', async () => {
    const res = await request(app.getHttpServer()).get('/api/sitemap/salon-slugs').expect(200);
    expect(res.body.items).not.toContain(pendingSlug);
  });

  it('returns an empty-but-valid page past the real last page', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/sitemap/salon-slugs')
      .query({ page: 99 })
      .expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBeGreaterThan(0);
  });
});
