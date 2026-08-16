import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';

export interface SalonOverrides {
  name?: string;
  genderTarget?: 'women' | 'men';
  address?: string;
  city?: string;
  lat?: number;
  lng?: number;
  capacity?: number;
  categoryIds?: number[];
}

export interface ServiceOverrides {
  name?: string;
  price?: number;
  durationMin?: number;
  discountPercent?: number;
}

// Every test DB has at least the migration-seeded categories, so callers never need their
// own category seed step -- same assumption every hand-rolled setup this replaces already
// made (`categoriesRes.body[0].id`).
async function firstCategoryId(app: INestApplication): Promise<number> {
  const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
  return res.body[0].id;
}

let salonCounter = 0;

/**
 * Creates a salon owned by `ownerCookie` and immediately approves it + opens it 24/7 (every
 * weekday, 00:00-23:00) via direct DB writes -- the exact two-step dance (POST /api/salons,
 * then an admin-approve + working_hours insert) that nearly two dozen e2e specs used to
 * hand-roll individually, byte-for-byte identical each time. A test that needs a specific
 * pending/rejected/suspended status, or specific working hours, should bypass this and do
 * that part inline instead -- this only covers the common "just give me a bookable salon"
 * case.
 */
export async function createApprovedSalon(
  app: INestApplication,
  ownerCookie: string,
  overrides: SalonOverrides = {},
): Promise<{ salonId: string; categoryId: number; slug: string }> {
  const categoryId = overrides.categoryIds?.[0] ?? (await firstCategoryId(app));
  salonCounter += 1;
  const res = await request(app.getHttpServer())
    .post('/api/salons')
    .set('Cookie', ownerCookie)
    .send({
      name: overrides.name ?? `Test Salon ${salonCounter}`,
      genderTarget: overrides.genderTarget ?? 'women',
      address: overrides.address ?? 'Somewhere St, No. 1',
      city: overrides.city ?? 'Tehran',
      lat: overrides.lat ?? 35.7,
      lng: overrides.lng ?? 51.4,
      capacity: overrides.capacity ?? 1,
      categoryIds: overrides.categoryIds ?? [categoryId],
    })
    .expect(201);
  const salonId: string = res.body.id;

  const ds = app.get(DataSource);
  await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
  await ds.query(
    `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
     SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
    [salonId],
  );

  return { salonId, categoryId, slug: res.body.slug };
}

/** Creates a service under the caller's own salon (POST /salons/mine/services -- scoped by
 *  SalonOwnerGuard from the cookie, no salonId needed in the body). */
export async function createService(
  app: INestApplication,
  ownerCookie: string,
  categoryId: number,
  overrides: ServiceOverrides = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/salons/mine/services')
    .set('Cookie', ownerCookie)
    .send({
      categoryId,
      name: overrides.name ?? 'Cut',
      price: overrides.price ?? 500000,
      durationMin: overrides.durationMin ?? 60,
      ...(overrides.discountPercent !== undefined ? { discountPercent: overrides.discountPercent } : {}),
    })
    .expect(201);
  return res.body.id;
}

/** The combo nearly every booking-flow e2e spec needs: an approved, 24/7-open salon with
 *  one bookable service. */
export async function createApprovedSalonWithService(
  app: INestApplication,
  ownerCookie: string,
  salonOverrides: SalonOverrides = {},
  serviceOverrides: ServiceOverrides = {},
): Promise<{ salonId: string; categoryId: number; serviceId: string; slug: string }> {
  const { salonId, categoryId, slug } = await createApprovedSalon(app, ownerCookie, salonOverrides);
  const serviceId = await createService(app, ownerCookie, categoryId, serviceOverrides);
  return { salonId, categoryId, serviceId, slug };
}
