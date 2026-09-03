import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { applyDiscount } from '../src/booking/discount.util';
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

    // A salon's own deliberate category tags -- independent of which services it
    // happens to list (search.service.ts's category filter reads THIS table, not
    // salon_services). Near is tagged only for the first category here; a later test
    // ("scopes the discounted minimum...") tags it into the second category too, to
    // exercise a salon matching more than one filter.
    await ds.query(
      `INSERT INTO salon_categories (salon_id, category_id) VALUES
        ('10000000-0000-4000-8000-000000000001', $1),
        ('10000000-0000-4000-8000-000000000002', $2)`,
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

    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['near-salon', 'far-salon']);
    expect(res.body.items[0].distanceKm).toBeLessThan(0.1);
    expect(res.body.items[1].distanceKm).toBeGreaterThan(1.5);
    expect(res.body.items[0].minPrice).toBe(500000);
    expect(res.body.items[0].hasActiveStory).toBe(false);
  });

  it('respects the radius', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', radiusKm: 1 })
      .expect(200);
    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['near-salon']);
  });

  it('filters by category', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: secondCategoryId })
      .expect(200);
    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['far-salon']);
  });

  it('filters by a case-insensitive substring of the salon name', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', q: 'near' })
      .expect(200);
    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['near-salon']);
  });

  it('returns an empty array when the name filter matches nothing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', q: 'no such salon exists' })
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('filters by price range -- matches a salon with at least one active service in range', async () => {
    // near-salon: Cut 500,000. far-salon: Manicure 300,000.
    const cheap = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', priceMax: 350000 })
      .expect(200);
    expect(cheap.body.items.map((s: { slug: string }) => s.slug)).toEqual(['far-salon']);

    const expensive = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', priceMin: 400000 })
      .expect(200);
    expect(expensive.body.items.map((s: { slug: string }) => s.slug)).toEqual(['near-salon']);

    const both = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', priceMin: 250000, priceMax: 350000 })
      .expect(200);
    expect(both.body.items.map((s: { slug: string }) => s.slug)).toEqual(['far-salon']);
  });

  it('filters men salons for gender=men', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'men' })
      .expect(200);
    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['mens-salon']);
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
    expect(res.body.items[0].slug).toBe('far-salon');
  });

  it('defaults to distance ordering when sort is omitted, even if rating would reorder', async () => {
    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET rating_avg = 5.0, rating_count = 50 WHERE slug = 'far-salon'`);
    await ds.query(`UPDATE salons SET rating_avg = 1.0, rating_count = 1 WHERE slug = 'near-salon'`);
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);
    expect(res.body.items.map((s: { slug: string }) => s.slug)).toEqual(['near-salon', 'far-salon']);
  });

  it('returns an empty array when no salon has the requested category', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: unusedCategoryId })
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('does NOT match a category filter merely because a salon has a service in it -- only an explicit salon_categories tag counts', async () => {
    const ds = app.get(DataSource);
    // A brand-new category with a service on near-salon, but deliberately no
    // salon_categories row for it -- the old derived-from-services behavior would
    // have matched near-salon here; the tag-based filter must not.
    const [{ id: untaggedCategoryId }] = await ds.query(
      `INSERT INTO service_categories (name, icon) VALUES ('Untagged Category', 'x') RETURNING id`,
    );
    // Priced absurdly high, deliberately: this service is permanent fixture pollution
    // for the rest of the file (never deactivated/removed), and the later minPrice
    // tests in this file compute MIN() over ALL of near-salon's active services with
    // no category filter -- a cheap price here would silently win those MIN()s and
    // break assertions written against the original, curated fixture set.
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min) VALUES
        ('10000000-0000-4000-8000-000000000001', $1, 'Has service, no tag', 999000000, 30)`,
      [untaggedCategoryId],
    );

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: untaggedCategoryId })
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("includes each salon's own tagged categories (id/name/icon) on every result row", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);

    const near = res.body.items.find((s: { slug: string }) => s.slug === 'near-salon');
    // Near was tagged with firstCategoryId in beforeAll (and, by the time this runs
    // depending on test order, possibly secondCategoryId too from an earlier test --
    // assert the baseline tag is present rather than the exact full set).
    expect(near.categories.some((c: { id: number }) => c.id === firstCategoryId)).toBe(true);
    expect(near.categories[0]).toHaveProperty('name');
    expect(near.categories[0]).toHaveProperty('icon');
  });

  it('rejects a missing gender param', () =>
    request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng })
      .expect(400));

  // Regression: these used to pass DTO validation (@Min alone) and then fail the ::bigint
  // bind inside Postgres -- a 500 (and an error-tracking event) on a public route.
  it.each([['1.5'], ['Infinity'], ['NaN'], ['99999999999999999999']])(
    'rejects a non-integer or out-of-range price filter (%s) with a 400, never a 500',
    (priceMin) =>
      request(app.getHttpServer())
        .get('/api/search')
        .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', priceMin })
        .expect(400),
  );

  it('flags hasActiveStory only for an unexpired published story', async () => {
    const ds = app.get(DataSource);
    // near: active published story; far: one expired + one removed-but-unexpired story --
    // neither may count (the EXISTS predicate is status='published' AND expires_at > now()).
    await ds.query(`
      INSERT INTO salon_stories (salon_id, url, storage_key, status, expires_at) VALUES
        ('10000000-0000-4000-8000-000000000001', 'http://x/uploads/a.jpg', 'salons/n/stories/a.jpg',
         'published', now() + interval '23 hours'),
        ('10000000-0000-4000-8000-000000000002', 'http://x/uploads/b.jpg', 'salons/f/stories/b.jpg',
         'published', now() - interval '1 minute'),
        ('10000000-0000-4000-8000-000000000002', 'http://x/uploads/c.jpg', 'salons/f/stories/c.jpg',
         'removed', now() + interval '23 hours')`);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);
    const bySlug = Object.fromEntries(res.body.items.map((s: { slug: string; hasActiveStory: boolean }) => [s.slug, s.hasActiveStory]));
    expect(bySlug['near-salon']).toBe(true);
    expect(bySlug['far-salon']).toBe(false);
  });

  // --- discounted minPrice ---------------------------------------------------------
  // These run last and each adds services to the existing fixture salons, so the exact
  // slug/minPrice assertions above stay untouched.

  const minPriceBySlug = async (query: Record<string, unknown>): Promise<Record<string, number | null>> => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', ...query })
      .expect(200);
    return Object.fromEntries(res.body.items.map((s: { slug: string; minPrice: number | null }) => [s.slug, s.minPrice]));
  };

  it('quotes the cheapest discounted price, not the discount applied to the cheapest raw price', async () => {
    const ds = app.get(DataSource);
    // Near now offers Cut 500,000 (no discount) and Color 400,000 at 50% off. The cheapest
    // service BEFORE the discount is Color at 400,000; the cheapest one AFTER it is Color at
    // 200,000 -- quoting 400,000 (the raw MIN) would advertise more than checkout charges.
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, discount_percent) VALUES
        ('10000000-0000-4000-8000-000000000001', $1, 'Color', 400000, 90, 50)`,
      [firstCategoryId],
    );

    const bySlug = await minPriceBySlug({});
    expect(bySlug['near-salon']).toBe(200000);
    // A NULL discount_percent is "no discount", never a free/100%-off one.
    expect(bySlug['far-salon']).toBe(300000);
  });

  it('rounds the discounted minimum exactly like applyDiscount', async () => {
    const ds = app.get(DataSource);
    // 249,997 at 50% off is 124,998.5 -- a half-toman tie whose floor is even, so it is the
    // one case where SQL banker's rounding (124,998) and JS Math.round (124,999) disagree.
    // The card must land on whatever checkout would charge.
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, discount_percent) VALUES
        ('10000000-0000-4000-8000-000000000002', $1, 'Pedicure', 249997, 60, 50)`,
      [secondCategoryId],
    );

    const bySlug = await minPriceBySlug({});
    expect(bySlug['far-salon']).toBe(applyDiscount(249997, 50));
    expect(bySlug['far-salon']).toBe(124999);
  });

  it('scopes the discounted minimum to the filtered category', async () => {
    const ds = app.get(DataSource);
    // Near's 200,000 bargain sits in the FIRST category; when the customer filters by the
    // second one, the quote has to come from the services they can actually see there.
    // Near also has to be explicitly TAGGED into the second category now (a salon can be
    // tagged into more than one) -- the filter itself no longer derives from services.
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min) VALUES
        ('10000000-0000-4000-8000-000000000001', $1, 'Nails', 350000, 60)`,
      [secondCategoryId],
    );
    await ds.query(
      `INSERT INTO salon_categories (salon_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      ['10000000-0000-4000-8000-000000000001', secondCategoryId],
    );

    const bySlug = await minPriceBySlug({ categoryId: secondCategoryId });
    expect(bySlug['near-salon']).toBe(350000);
    expect(bySlug['far-salon']).toBe(124999);
  });

  it('ignores inactive services however deeply discounted', async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, discount_percent, is_active) VALUES
        ('10000000-0000-4000-8000-000000000001', $1, 'Retired Offer', 100000, 30, 90, false)`,
      [firstCategoryId],
    );

    const bySlug = await minPriceBySlug({});
    expect(bySlug['near-salon']).toBe(200000);
  });

  // --- cursor pagination -------------------------------------------------------------

  it('responds with the {items, nextCursor, hasMore} shape, hasMore=false and nextCursor=null on a single page', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  describe('walking multiple pages', () => {
    const PAGE_SALON_COUNT = 5;
    const PAGE_SIZE = 2;

    beforeAll(async () => {
      const ds = app.get(DataSource);
      const ownerRows = Array.from({ length: PAGE_SALON_COUNT }, (_, i) => `('00000000-0000-4000-9000-00000000000${i}', '0913000000${i}', 'provider')`).join(',');
      await ds.query(`INSERT INTO users (id, phone, role) VALUES ${ownerRows}`);

      // Spread east from the anchor in small, strictly-increasing steps so distance
      // ordering is deterministic and every salon lands inside the default 15km radius.
      const salonRows = Array.from({ length: PAGE_SALON_COUNT }, (_, i) => {
        const lng = ANCHOR.lng + (i + 1) * 0.01;
        return `('20000000-0000-4000-9000-00000000000${i}', '00000000-0000-4000-9000-00000000000${i}', 'Page Salon ${i}', 'page-salon-${i}', 'women', 'approved', 'Addr ${i}', 'Tehran', ST_SetSRID(ST_MakePoint(${lng}, ${ANCHOR.lat}), 4326)::geography)`;
      }).join(',');
      await ds.query(`
        INSERT INTO salons (id, owner_id, name, slug, gender_target, status, address, city, location)
        VALUES ${salonRows}`);
    });

    it('walks every page via nextCursor with no gaps or duplicates, ending on hasMore=false', async () => {
      const seenSlugs: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      while (guard++ < 20) {
        const res = await request(app.getHttpServer())
          .get('/api/search')
          .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', pageSize: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
          .expect(200);

        const slugs = res.body.items.filter((s: { slug: string }) => s.slug.startsWith('page-salon-')).map((s: { slug: string }) => s.slug);
        seenSlugs.push(...slugs);
        expect(res.body.items.length).toBeLessThanOrEqual(PAGE_SIZE);

        if (!res.body.hasMore) {
          expect(res.body.nextCursor).toBeNull();
          break;
        }
        expect(res.body.nextCursor).toEqual(expect.any(String));
        cursor = res.body.nextCursor;
      }

      // near-salon/far-salon (and mens-salon, gender-filtered out) from the outer
      // fixture are mixed in too, but every page-salon-N must show up exactly once.
      expect(new Set(seenSlugs).size).toBe(seenSlugs.length);
      for (let i = 0; i < PAGE_SALON_COUNT; i++) {
        expect(seenSlugs).toContain(`page-salon-${i}`);
      }
    });

    it('an unrecognized/malformed cursor restarts from page 1 instead of erroring', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', pageSize: PAGE_SIZE, cursor: 'not-a-real-cursor' })
        .expect(200);

      expect(res.body.items.length).toBeLessThanOrEqual(PAGE_SIZE);
    });
  });
});
