import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin platform config (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122310001');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every seeded config key', async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const keys = res.body.map((row: { key: string }) => row.key).sort();
    // listAll() is scoped to REQUIRED_PLATFORM_CONFIG_KEYS (numeric only) -- the
    // feature_*_enabled rows are a separate concern with their own dedicated endpoint
    // (admin-feature-flags.e2e-spec.ts), deliberately excluded here so this numeric
    // screen's PATCH round-trip never has to see a boolean value.
    expect(keys).toEqual([
      'booking_approval_timeout_minutes',
      'booking_hold_ttl_minutes',
      'cancellation_window_hours',
      'commission_percent',
      'deposit_min_toman',
      'deposit_percent',
      'no_show_grace_minutes',
      'reminder_lead_hours',
      'review_edit_window_hours',
    ]);
  });

  it('bulk-updates several keys and reflects the change in a follow-up read', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'commission_percent', value: 12 }, { key: 'deposit_percent', value: 25 }] })
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const byKey = Object.fromEntries(res.body.map((r: { key: string; value: unknown }) => [r.key, r.value]));
    expect(byKey.commission_percent).toBe(12);
    expect(byKey.deposit_percent).toBe(25);
  });

  // Regression pin for a real bug: ConfigView.vue's confirmSave() sends back every row
  // GET /admin/config returned, not just the changed one (see PlatformConfigService.
  // listAll's own doc comment) -- if that GET ever leaked a non-numeric row (e.g. a
  // feature_*_enabled boolean) back into this exact round-trip, the PATCH's @IsNumber()
  // validation would 400 the whole request and the admin-panel's confirm screen would
  // never close. Caught live via a real admin-panel Playwright e2e failure.
  it('round-trips every row from a GET straight back through PATCH unmodified (the real UI\'s exact save flow), without 400ing', async () => {
    const listRes = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const updates = listRes.body.map((row: { key: string; value: number }) => ({ key: row.key, value: row.value }));

    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates })
      .expect(200);
  });

  it('rejects a non-numeric value', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'commission_percent', value: 'not a number' }] })
      .expect(400);
  });

  it('rejects a batch containing an unknown key and leaves the valid key unchanged', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({
        updates: [
          { key: 'commission_percent', value: 40 },
          { key: 'commission_precent', value: 5 },
        ],
      })
      .expect(404);

    const res = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const byKey = Object.fromEntries(res.body.map((r: { key: string; value: unknown }) => [r.key, r.value]));
    // Unchanged from the earlier successful bulk-update test, proving the
    // rejected batch didn't partially write before the unknown key was hit.
    expect(byKey.commission_percent).toBe(12);
    expect(byKey.commission_precent).toBeUndefined();
  });

  it('rejects an empty-string key', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: '', value: 10 }] })
      .expect(400);
  });

  it('a value change is reflected immediately on the public read path, not just after the cache TTL (write-through invalidation)', async () => {
    // GET /platform-config/booking-terms is the actual cached, public read path
    // (PlatformConfigService.getNumber()) -- distinct from GET /admin/config above, which
    // always reads straight from Postgres (listAll() is never cached).
    const before = await request(app.getHttpServer()).get('/api/platform-config/booking-terms').expect(200);
    const newDepositPercent = before.body.depositPercent === 30 ? 35 : 30;

    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'deposit_percent', value: newDepositPercent }] })
      .expect(200);

    const after = await request(app.getHttpServer()).get('/api/platform-config/booking-terms').expect(200);
    expect(after.body.depositPercent).toBe(newDepositPercent);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122310099');
    await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', customerCookie).expect(403);
  });
});
