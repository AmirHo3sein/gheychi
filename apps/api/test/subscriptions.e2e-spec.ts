import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalon } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

describe('Plans & salon subscriptions (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let freePlanId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, '09191110001');
    ownerCookie = await loginAs(app, '09191110002');
    ({ salonId } = await createApprovedSalon(app, ownerCookie, { name: 'Subscription Test Salon' }));

    const [freePlan] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);
    freePlanId = freePlan.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('salon creation', () => {
    it('gives a newly created salon an active subscription on the default plan', async () => {
      const [sub] = await ds.query(`SELECT plan_id, status FROM salon_subscriptions WHERE salon_id = $1`, [salonId]);
      expect(sub).toBeDefined();
      expect(sub.plan_id).toBe(freePlanId);
      expect(sub.status).toBe('active');
    });
  });

  describe('admin plans CRUD', () => {
    it('lists the seeded free plan, flagged as default', async () => {
      const res = await request(app.getHttpServer()).get('/api/admin/plans').set('Cookie', adminCookie).expect(200);
      const free = res.body.find((p: { key: string }) => p.key === 'free');
      expect(free).toBeDefined();
      expect(free.isDefault).toBe(true);
      expect(free.monthlyPriceToman).toBe(0);
    });

    it('creates a new plan with placeholder entitlements', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', adminCookie)
        .send({ key: 'plus', name: 'پلاس', monthlyPriceToman: 490000, entitlements: { smsMonthlyQuota: 100 } })
        .expect(201);

      expect(res.body.key).toBe('plus');
      expect(res.body.isDefault).toBe(false);
      expect(res.body.entitlements).toEqual({ smsMonthlyQuota: 100 });
    });

    // A typo in this free-form JSON bag previously saved silently -- the resolution
    // engine's absent-default for the real key (0 for smsMonthlyQuota) then applied with
    // no admin-visible signal at all. This is the API-boundary fix for that.
    it('rejects a plan entitlements bag with an unknown key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', adminCookie)
        .send({ key: 'typo-plan', name: 'تایپو', entitlements: { smsMonthlyQouta: 100 } })
        .expect(400);

      expect(res.body.message.join(' ')).toContain('smsMonthlyQouta');
    });

    it('rejects a duplicate key with a clean conflict', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', adminCookie)
        .send({ key: 'plus', name: 'پلاس دوباره' })
        .expect(409);
    });

    it('updates a plan\'s editable fields', async () => {
      const [plus] = await ds.query(`SELECT id FROM plans WHERE key = 'plus'`);
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/plans/${plus.id}`)
        .set('Cookie', adminCookie)
        .send({ name: 'پلاس ویژه', monthlyPriceToman: 590000 })
        .expect(200);

      expect(res.body.name).toBe('پلاس ویژه');
      expect(res.body.monthlyPriceToman).toBe(590000);
      // key is immutable -- absent from UpdatePlanDto entirely, never touched by the update.
      expect(res.body.key).toBe('plus');
    });

    it('moving isDefault to a different plan atomically unsets the previous default', async () => {
      const [plus] = await ds.query(`SELECT id FROM plans WHERE key = 'plus'`);

      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${plus.id}`)
        .set('Cookie', adminCookie)
        .send({ isDefault: true })
        .expect(200);

      const rows = await ds.query(`SELECT key, is_default FROM plans ORDER BY key`);
      expect(rows.find((r: { key: string }) => r.key === 'plus').is_default).toBe(true);
      expect(rows.find((r: { key: string }) => r.key === 'free').is_default).toBe(false);
      expect(rows.filter((r: { is_default: boolean }) => r.is_default)).toHaveLength(1);

      // Restore for the rest of this file's tests / other e2e files sharing this DB.
      const [free] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);
      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${free.id}`)
        .set('Cookie', adminCookie)
        .send({ isDefault: true })
        .expect(200);
    });

    it('refuses to unset the only default plan directly', async () => {
      const [free] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);
      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${free.id}`)
        .set('Cookie', adminCookie)
        .send({ isDefault: false })
        .expect(409);
    });

    it('refuses to delete the default plan', async () => {
      const [free] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);
      await request(app.getHttpServer()).delete(`/api/admin/plans/${free.id}`).set('Cookie', adminCookie).expect(409);
    });

    // The default plan can never be inactive (createDefaultSubscription reads isDefault
    // only, and assignPlan refuses an inactive plan) -- previously proven only by a mocked
    // unit test, not against a real Postgres row.
    it('refuses to deactivate the default plan directly', async () => {
      const [free] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);
      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${free.id}`)
        .set('Cookie', adminCookie)
        .send({ isActive: false })
        .expect(409);

      const [row] = await ds.query(`SELECT is_active FROM plans WHERE id = $1`, [free.id]);
      expect(row.is_active).toBe(true);
    });

    it('refuses to delete a plan a salon is subscribed to', async () => {
      const [plus] = await ds.query(`SELECT id FROM plans WHERE key = 'plus'`);
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .send({ planId: plus.id })
        .expect(200);

      await request(app.getHttpServer()).delete(`/api/admin/plans/${plus.id}`).set('Cookie', adminCookie).expect(409);
    });

    // The subscriber-visibility gap this closes: before this, an admin had no way to see
    // which salons are on a plan before editing or deactivating it, short of opening every
    // salon's own detail page. salonId was moved onto 'plus' by the test just above.
    it('reports subscriberCount per plan, and lets an admin list exactly which salons are on one', async () => {
      const [plus] = await ds.query(`SELECT id FROM plans WHERE key = 'plus'`);
      const [free] = await ds.query(`SELECT id FROM plans WHERE key = 'free'`);

      const list = await request(app.getHttpServer()).get('/api/admin/plans').set('Cookie', adminCookie).expect(200);
      const plusRow = list.body.find((p: { key: string }) => p.key === 'plus');
      const freeRow = list.body.find((p: { key: string }) => p.key === 'free');
      expect(plusRow.subscriberCount).toBe(1);
      expect(freeRow.subscriberCount).toBe(0);

      const salons = await request(app.getHttpServer())
        .get(`/api/admin/plans/${plus.id}/salons`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(salons.body).toHaveLength(1);
      expect(salons.body[0].id).toBe(salonId);

      const emptySalons = await request(app.getHttpServer())
        .get(`/api/admin/plans/${free.id}/salons`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(emptySalons.body).toEqual([]);
    });

    it('404s listing salons for an unknown plan id', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/plans/00000000-0000-0000-0000-000000000000/salons')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('rejects a non-admin caller listing a plan\'s salons', async () => {
      const [plus] = await ds.query(`SELECT id FROM plans WHERE key = 'plus'`);
      await request(app.getHttpServer())
        .get(`/api/admin/plans/${plus.id}/salons`)
        .set('Cookie', ownerCookie)
        .expect(403);
    });

    it('deletes an unused, non-default plan cleanly', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', adminCookie)
        .send({ key: 'throwaway', name: 'موقت' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/admin/plans/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
    });

    it('rejects a non-admin caller on both read and write', async () => {
      await request(app.getHttpServer()).get('/api/admin/plans').set('Cookie', ownerCookie).expect(403);
      await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', ownerCookie)
        .send({ key: 'nope', name: 'x' })
        .expect(403);
    });

    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/api/admin/plans').expect(401);
    });
  });

  describe('admin salon subscription management', () => {
    it('reads the salon\'s current subscription and plan', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.subscription.salonId).toBe(salonId);
      expect(res.body.plan.key).toBe('plus'); // assigned in the plans-CRUD describe block above
    });

    it('404s assigning an unknown plan id', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .send({ planId: '00000000-0000-0000-0000-000000000000' })
        .expect(404);
    });

    it('refuses to assign an inactive plan', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/plans')
        .set('Cookie', adminCookie)
        .send({ key: 'inactive-plan', name: 'غیرفعال' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .send({ planId: created.body.id })
        .expect(409);
    });

    it('cancels the subscription, then refuses to cancel it twice', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/cancel`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.subscription.status).toBe('canceled');
      expect(res.body.subscription.canceledAt).not.toBeNull();

      await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/cancel`)
        .set('Cookie', adminCookie)
        .expect(409);
    });

    it('a canceled subscription resolves to the default plan\'s entitlements, not the nominal plan\'s', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.subscription.status).toBe('canceled');
      // Nominal plan is whatever the row still references (free, from the earlier re-assign
      // in this file) -- resolvedEntitlements is what's ACTUALLY in effect, which falls back
      // to the platform default plan's entitlements while canceled. {smsMonthlyQuota: 20} is
      // the Phase 6 migration's own placeholder backfill onto the (only, default) free plan --
      // see salon-sms-messages migration and docs/technical-overview/33-salon-sms-quota.md.
      expect(res.body.resolvedEntitlements).toEqual({ smsMonthlyQuota: 20 });
    });

    it('re-assigning a plan reactivates a canceled subscription', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .send({ planId: freePlanId })
        .expect(200);

      expect(res.body.subscription.status).toBe('active');
      expect(res.body.subscription.canceledAt).toBeNull();
    });

    it('rejects a non-admin caller', async () => {
      await request(app.getHttpServer())
        .get(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', ownerCookie)
        .expect(403);
    });
  });

  describe('admin salon-specific entitlement overrides', () => {
    it('merges an override on top of the plan entitlements in resolvedEntitlements', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/plans/${freePlanId}`)
        .set('Cookie', adminCookie)
        .send({ entitlements: { smsMonthlyQuota: 50, crmCustomerCap: 100 } })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: { smsMonthlyQuota: 500 } })
        .expect(200);

      expect(res.body.subscription.entitlementOverrides).toEqual({ smsMonthlyQuota: 500 });
      expect(res.body.resolvedEntitlements).toEqual({ smsMonthlyQuota: 500, crmCustomerCap: 100 });
    });

    it('clears every override when sent null', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: null })
        .expect(200);

      expect(res.body.subscription.entitlementOverrides).toBeNull();
      expect(res.body.resolvedEntitlements).toEqual({ smsMonthlyQuota: 50, crmCustomerCap: 100 });
    });

    it('rejects an override bag with an unknown key', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: { crmCustomerCapp: 5 } })
        .expect(400);

      expect(res.body.message.join(' ')).toContain('crmCustomerCapp');

      // The rejected write must not have applied -- still whatever the prior test left.
      const after = await request(app.getHttpServer())
        .get(`/api/admin/salons/${salonId}/subscription`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(after.body.subscription.entitlementOverrides).toBeNull();
    });

    it('rejects a body with neither null nor an object', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: 'not-an-object' })
        .expect(400);
    });

    it('rejects a non-admin caller', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
        .set('Cookie', ownerCookie)
        .send({ overrides: null })
        .expect(403);
    });
  });

  describe('GET /salons/mine/subscription (provider, read-only)', () => {
    it('lets the owner read their own plan and resolved entitlements', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/subscription')
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(res.body.subscription.salonId).toBe(salonId);
      expect(res.body.resolvedEntitlements).toEqual({ smsMonthlyQuota: 50, crmCustomerCap: 100 });
    });

    it('has no write route at all -- the owner cannot change plan/status/overrides here', async () => {
      await request(app.getHttpServer())
        .patch('/api/salons/mine/subscription')
        .set('Cookie', ownerCookie)
        .send({ planId: freePlanId })
        .expect(404);
    });

    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer()).get('/api/salons/mine/subscription').expect(401);
    });
  });
});
