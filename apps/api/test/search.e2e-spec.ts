import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ANCHOR = { lat: 35.7219, lng: 51.3347 };

describe('Search (e2e)', () => {
  let app: INestApplication;
  let firstCategoryId: number;
  let secondCategoryId: number;
  let unusedCategoryId: number;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const ds = app.get(DataSource);

    // owner users
    await ds.query(`
      INSERT INTO users (id, phone, role) VALUES
        ('00000000-0000-4000-8000-000000000001', '09120000001', 'provider'),
        ('00000000-0000-4000-8000-000000000002', '09120000002', 'provider'),
        ('00000000-0000-4000-8000-000000000003', '09120000003', 'provider'),
        ('00000000-0000-4000-8000-000000000004', '09120000004', 'provider')`);

    // near: ~0km; far: ~2.2km east; men: near but wrong gender; pending: near but not approved
    await ds.query(`
      INSERT INTO salons (id, owner_id, name, slug, gender_target, status, address, city, location) VALUES
        ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
         'Near Salon', 'near-salon', 'women', 'approved', 'A', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3347, 35.7219), 4326)::geography),
        ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
         'Far Salon', 'far-salon', 'women', 'approved', 'B', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3590, 35.7219), 4326)::geography),
        ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003',
         'Mens Salon', 'mens-salon', 'men', 'approved', 'C', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3350, 35.7220), 4326)::geography),
        ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004',
         'Pending Salon', 'pending-salon', 'women', 'pending', 'D', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3348, 35.7218), 4326)::geography)`);

    // Category ids are resolved from the seeded rows (not hardcoded) so the fixture
    // survives reseeds of service_categories; the third id stays unattached to any salon.
    const categories = await ds.query(`SELECT id FROM service_categories ORDER BY id LIMIT 3`);
    firstCategoryId = categories[0].id;
    secondCategoryId = categories[1].id;
    unusedCategoryId = categories[2].id;

    // services: Near offers a service in the first category (500k); Far in the second (300k);
    // the third category stays unattached to any salon
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min) VALUES
        ('10000000-0000-4000-8000-000000000001', $1, 'Cut', 500000, 45),
        ('10000000-0000-4000-8000-000000000002', $2, 'Manicure', 300000, 60)`,
      [firstCategoryId, secondCategoryId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns approved women salons ordered by distance with minPrice', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);

    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['near-salon', 'far-salon']);
    expect(res.body[0].distanceKm).toBeLessThan(0.1);
    expect(res.body[1].distanceKm).toBeGreaterThan(1.5);
    expect(res.body[0].minPrice).toBe(500000);
  });

  it('respects the radius', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', radiusKm: 1 })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['near-salon']);
  });

  it('filters by category', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: secondCategoryId })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['far-salon']);
  });

  it('filters men salons for gender=men', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'men' })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['mens-salon']);
  });

  it('sorts by rating when requested', async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE salons SET rating_avg = 4.9, rating_count = 10 WHERE slug = 'far-salon'`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', sort: 'rating' })
      .expect(200);
    expect(res.body[0].slug).toBe('far-salon');
  });

  it('defaults to distance ordering when sort is omitted, even if rating would reorder', async () => {
    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET rating_avg = 5.0, rating_count = 50 WHERE slug = 'far-salon'`);
    await ds.query(`UPDATE salons SET rating_avg = 1.0, rating_count = 1 WHERE slug = 'near-salon'`);
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['near-salon', 'far-salon']);
  });

  it('returns an empty array when no salon has the requested category', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: unusedCategoryId })
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a missing gender param', () =>
    request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng })
      .expect(400));
});
