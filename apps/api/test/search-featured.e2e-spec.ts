import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { resetDatabase, testDataSource } from './utils/db';

describe('Search — featured salon boost (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedApprovedSalon(
    name: string,
    lng: number,
    lat: number,
    featured: boolean,
    featuredUntil: string | null = null,
  ) {
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 7);
    const [{ id }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location, is_featured, featured_until)
       VALUES ($1, $2, $3, 'women', 'approved', 'test address', 'Tehran',
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7)
       RETURNING id`,
      [ownerId, name, slug, lng, lat, featured, featuredUntil],
    );
    await ds.destroy();
    return id as string;
  }

  it('places featured salons ahead of closer non-featured ones, capped at 2', async () => {
    // all salons within a few hundred meters of this point
    const lng = 51.389, lat = 35.7;
    await seedApprovedSalon('Closest Non-Featured', lng + 0.0001, lat, false);
    const featured1 = await seedApprovedSalon('Featured One', lng + 0.01, lat, true);
    const featured2 = await seedApprovedSalon('Featured Two', lng + 0.011, lat, true);
    await seedApprovedSalon('Featured Three (over cap)', lng + 0.012, lat, true);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 5 })
      .expect(200);

    const featuredCount = res.body.items.filter((r: { isFeatured: boolean }) => r.isFeatured).length;
    expect(featuredCount).toBe(2);
    expect(res.body.items[0].isFeatured).toBe(true);
    expect(res.body.items[1].isFeatured).toBe(true);
    expect([featured1, featured2]).toContain(res.body.items[0].id);
    expect([featured1, featured2]).toContain(res.body.items[1].id);
  });

  it('never surfaces a featured salon that does not match the gender filter', async () => {
    const lng = 51.4, lat = 35.71;
    const ds = testDataSource();
    await ds.initialize();
    const [{ id: ownerId }] = await ds.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`,
      [`09${Math.floor(100000000 + Math.random() * 899999999)}`],
    );
    await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location, is_featured)
       VALUES ($1, 'Mens Featured', 'mens-featured-test', 'men', 'approved', 'addr', 'Tehran',
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, true)`,
      [ownerId, lng, lat],
    );
    await ds.destroy();

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 1 })
      .expect(200);

    expect(res.body.items.find((r: { name: string }) => r.name === 'Mens Featured')).toBeUndefined();
  });

  it('does not boost or badge a featured salon whose featured_until has already passed', async () => {
    const lng = 51.42, lat = 35.72;
    const expiredUntil = new Date(Date.now() - 60_000).toISOString(); // 1 minute in the past
    const closerNonFeatured = await seedApprovedSalon('Closer Non-Featured (expiry test)', lng + 0.0001, lat, false);
    const expiredFeatured = await seedApprovedSalon('Expired Featured', lng + 0.0002, lat, true, expiredUntil);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 5 })
      .expect(200);

    const expired = res.body.items.find((r: { id: string }) => r.id === expiredFeatured);
    expect(expired).toBeDefined();
    expect(expired.isFeatured).toBe(false);

    const nonFeaturedIdx = res.body.items.findIndex((r: { id: string }) => r.id === closerNonFeatured);
    const expiredIdx = res.body.items.findIndex((r: { id: string }) => r.id === expiredFeatured);
    // with the boost gone, plain distance ordering applies: the closer salon comes first
    expect(nonFeaturedIdx).toBeLessThan(expiredIdx);
  });

  it('reinserts an over-cap featured salon by distance instead of leaving it ranked ahead of closer salons', async () => {
    const lng = 51.44, lat = 35.73;
    const closestNonFeatured = await seedApprovedSalon('Closest Non-Featured (cap-rank test)', lng + 0.0001, lat, false);
    const featured1 = await seedApprovedSalon('Cap Rank Featured One', lng + 0.01, lat, true);
    const featured2 = await seedApprovedSalon('Cap Rank Featured Two', lng + 0.011, lat, true);
    const overCapFeatured = await seedApprovedSalon('Cap Rank Featured Three (over cap)', lng + 0.012, lat, true);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat, lng, gender: 'women', radiusKm: 5 })
      .expect(200);

    const overCapEntry = res.body.items.find((r: { id: string }) => r.id === overCapFeatured);
    expect(overCapEntry.isFeatured).toBe(false);

    const closestIdx = res.body.items.findIndex((r: { id: string }) => r.id === closestNonFeatured);
    const overCapIdx = res.body.items.findIndex((r: { id: string }) => r.id === overCapFeatured);
    const featured1Idx = res.body.items.findIndex((r: { id: string }) => r.id === featured1);
    const featured2Idx = res.body.items.findIndex((r: { id: string }) => r.id === featured2);

    // the two capped-featured salons keep their boosted top spots...
    expect(featured1Idx).toBeLessThan(closestIdx);
    expect(featured2Idx).toBeLessThan(closestIdx);
    // ...but the over-cap salon must be re-ranked by distance, landing behind the
    // much-closer non-featured salon rather than keeping its unearned featured slot.
    expect(closestIdx).toBeLessThan(overCapIdx);
  });
});
