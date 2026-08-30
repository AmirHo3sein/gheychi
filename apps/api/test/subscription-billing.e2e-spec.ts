import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalon } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * Subscription coupons + billing-architecture scaffolding (Phase 7 of the monetization
 * initiative -- see docs/technical-overview/34-subscription-coupons-and-billing.md).
 * Billing stays architecture-only: every period here is admin-created and admin-resolved,
 * there is no real Zarinpal charge anywhere in this flow.
 */
describe('Subscription coupons + billing (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let planId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, '09171110001');
    ownerCookie = await loginAs(app, '09171110002');
    ({ salonId } = await createApprovedSalon(app, ownerCookie, { name: 'Billing Test Salon' }));

    // The seeded free plan is 0 toman -- create and assign a real priced plan so discount
    // math is actually observable.
    const plan = await request(app.getHttpServer())
      .post('/api/admin/plans')
      .set('Cookie', adminCookie)
      .send({ key: 'billing-plus', name: 'پلاس', monthlyPriceToman: 500_000 })
      .expect(201);
    planId = plan.body.id;
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/subscription`)
      .set('Cookie', adminCookie)
      .send({ planId })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('admin subscription coupons CRUD', () => {
    it('creates, lists, and deactivates a subscription coupon', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/subscription-coupons')
        .set('Cookie', adminCookie)
        .send({ code: 'plus20', discountPercent: 20 })
        .expect(201);
      expect(created.body.code).toBe('PLUS20'); // normalized to uppercase

      const list = await request(app.getHttpServer()).get('/api/admin/subscription-coupons').set('Cookie', adminCookie).expect(200);
      expect(list.body.some((c: { id: string }) => c.id === created.body.id)).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/admin/subscription-coupons/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
      const afterDelete = await request(app.getHttpServer())
        .get('/api/admin/subscription-coupons')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(afterDelete.body.find((c: { id: string }) => c.id === created.body.id).isActive).toBe(false);
    });

    it('rejects a duplicate code', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/subscription-coupons')
        .set('Cookie', adminCookie)
        .send({ code: 'DUPCODE', discountPercent: 10 })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/admin/subscription-coupons')
        .set('Cookie', adminCookie)
        .send({ code: 'dupcode', discountPercent: 15 })
        .expect(409);
    });
  });

  describe('billing periods', () => {
    it('bills the current plan price verbatim with no coupon applied', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' })
        .expect(201);

      expect(res.body).toMatchObject({ salonId, planId, baseAmountToman: 500_000, amountToman: 500_000, couponId: null, status: 'pending' });
    });

    it('rejects a period whose end is not after its start', () =>
      request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z' })
        .expect(400));

    it('applies a valid subscription coupon and records exactly one redemption for this salon', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/subscription-coupons')
        .set('Cookie', adminCookie)
        .send({ code: 'BILLING20', discountPercent: 20 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', couponCode: 'billing20' })
        .expect(201);
      expect(res.body).toMatchObject({ baseAmountToman: 500_000, discountPercent: 20, amountToman: 400_000 });

      const [{ count }] = await ds.query(`SELECT COUNT(*) FROM subscription_coupon_redemptions WHERE coupon_id = (SELECT id FROM subscription_coupons WHERE code = 'BILLING20')`);
      expect(Number(count)).toBe(1);

      // Same salon, same coupon, a second time -- rejected (one redemption per salon per code).
      await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', couponCode: 'BILLING20' })
        .expect(400);
    });

    it('rejects an unknown coupon code', () =>
      request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', couponCode: 'NOPE' })
        .expect(400));

    it('marks a pending period paid, then refuses to resolve it again', async () => {
      const created = await request(app.getHttpServer())
        .post(`/api/admin/salons/${salonId}/subscription/billing-periods`)
        .set('Cookie', adminCookie)
        .send({ periodStart: '2026-12-01T00:00:00.000Z', periodEnd: '2027-01-01T00:00:00.000Z' })
        .expect(201);

      const marked = await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/billing-periods/${created.body.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'paid' })
        .expect(200);
      expect(marked.body.status).toBe('paid');
      expect(marked.body.resolvedAt).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${salonId}/subscription/billing-periods/${created.body.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'comped' })
        .expect(409);
    });

    it('the salon owner can read their own billing history but has no route to create or resolve one', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/subscription/billing-periods')
        .set('Cookie', ownerCookie)
        .expect(200);
      // Exactly the 3 successfully-created periods from the earlier tests in this file
      // (the rejected-coupon and duplicate-redemption attempts never inserted a row).
      expect(res.body.length).toBe(3);

      await request(app.getHttpServer())
        .post('/api/salons/mine/subscription/billing-periods')
        .set('Cookie', ownerCookie)
        .send({ periodStart: '2027-01-01T00:00:00.000Z', periodEnd: '2027-02-01T00:00:00.000Z' })
        .expect(404); // no such route on the owner-facing controller
    });

    it('a caller with no salon of their own gets a 404, never this salon\'s data', async () => {
      const otherOwnerCookie = await loginAs(app, '09171110003');
      await request(app.getHttpServer()).get('/api/salons/mine/subscription/billing-periods').set('Cookie', otherOwnerCookie).expect(404);
    });
  });
});
