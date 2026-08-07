import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ANCHOR = { lat: 35.7219, lng: 51.3347 };
const OWNER_CASCADE = '00000000-0000-4000-8000-000000000021';
const OWNER_DIRECT = '00000000-0000-4000-8000-000000000022';
const SALON_CASCADE = '10000000-0000-4000-8000-000000000021';
const SALON_DIRECT = '10000000-0000-4000-8000-000000000022';

describe('Cascade suspend/reactivate (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;

  const searchSlugs = async (): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);
    return res.body.items.map((s: { slug: string }) => s.slug);
  };

  const setUserStatus = (userId: string, status: 'active' | 'suspended') =>
    request(app.getHttpServer())
      .patch(`/api/admin/users/${userId}/status`)
      .set('Cookie', adminCookie)
      .send({ status })
      .expect(200);

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    adminCookie = await loginAsAdmin(app, '09122400001');

    // Two provider owners, seeded directly (they never log in; only the admin acts).
    await ds.query(`
      INSERT INTO users (id, phone, role) VALUES
        ('${OWNER_CASCADE}', '09122400002', 'provider'),
        ('${OWNER_DIRECT}', '09122400003', 'provider')`);

    // Two approved women salons near the anchor, one per owner.
    await ds.query(`
      INSERT INTO salons (id, owner_id, name, slug, gender_target, status, address, city, location) VALUES
        ('${SALON_CASCADE}', '${OWNER_CASCADE}',
         'Cascade Salon', 'cascade-salon', 'women', 'approved', 'A', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3347, 35.7219), 4326)::geography),
        ('${SALON_DIRECT}', '${OWNER_DIRECT}',
         'Direct Salon', 'direct-salon', 'women', 'approved', 'B', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3350, 35.7220), 4326)::geography)`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows both approved salons publicly before any suspension', async () => {
    expect(await searchSlugs()).toEqual(expect.arrayContaining(['cascade-salon', 'direct-salon']));
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(200);
  });

  it('suspending the owner hides the salon from search and 404s its public profile', async () => {
    await setUserStatus(OWNER_CASCADE, 'suspended');

    expect(await searchSlugs()).not.toContain('cascade-salon');
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(404);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_CASCADE]);
    expect(salon).toEqual({ status: 'suspended', suspended_cause: 'owner_suspended' });
  });

  it('reactivating the owner restores the cascade-suspended salon', async () => {
    await setUserStatus(OWNER_CASCADE, 'active');

    expect(await searchSlugs()).toContain('cascade-salon');
    await request(app.getHttpServer()).get('/api/salons/cascade-salon').expect(200);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_CASCADE]);
    expect(salon).toEqual({ status: 'approved', suspended_cause: null });
  });

  it('does NOT restore a directly-suspended salon when its owner is reactivated', async () => {
    // An admin suspends the salon itself (records suspended_cause='admin', Task 15a) ...
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${SALON_DIRECT}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'تخلف از قوانین پلتفرم' })
      .expect(200);

    // ... then the owner is suspended and later reactivated.
    await setUserStatus(OWNER_DIRECT, 'suspended');
    await setUserStatus(OWNER_DIRECT, 'active');

    // The salon stays down: the reactivate cascade only matches suspended_cause='owner_suspended'.
    expect(await searchSlugs()).not.toContain('direct-salon');
    await request(app.getHttpServer()).get('/api/salons/direct-salon').expect(404);

    const [salon] = await ds.query(`SELECT status, suspended_cause FROM salons WHERE id = $1`, [SALON_DIRECT]);
    expect(salon).toEqual({ status: 'suspended', suspended_cause: 'admin' });
  });

  it('wrote a user.status.set audit row for every user-status change above', async () => {
    // AuditInterceptor awaits the insert before the HTTP response is sent (see Task 4),
    // so the rows are guaranteed to exist by now — no polling or sleeps needed.
    const rows: Array<{ target_id: string; success: boolean }> = await ds.query(
      `SELECT target_id, success FROM audit_log WHERE action = 'user.status.set' ORDER BY created_at`,
    );

    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.success)).toBe(true);
    expect(rows.map((r) => r.target_id)).toEqual([OWNER_CASCADE, OWNER_CASCADE, OWNER_DIRECT, OWNER_DIRECT]);
  });
});
