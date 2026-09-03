import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * Salon-initiated customer SMS + monthly quota (Phase 6 of the monetization initiative --
 * see docs/technical-overview/33-salon-sms-quota.md). The quota comes from the real
 * entitlement engine (Phase 2/3), overridden here via the real admin endpoint so the test
 * doesn't have to send 20 real messages to exercise exhaustion.
 */
describe('Salon SMS + quota (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let adminCookie: string;
  let customerId: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09161110001');
    adminCookie = await loginAsAdmin(app, '09161110099');
    ({ salonId } = await createApprovedSalonWithService(app, ownerCookie, { name: 'SMS Test Salon' }, { price: 500_000 }));

    const customerCookie = await loginAs(app, '09161110002');
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', customerCookie).expect(200);
    customerId = me.body.id;
    // A real booking is what makes this user "this salon's customer" at all -- ownership
    // isolation is enforced by the exact same bookings-table query the CRM feature uses.
    await ds.query(
      `INSERT INTO bookings (salon_id, user_id, service_id, worker_id, starts_at, ends_at, status, price_snapshot, deposit_amount, source)
       SELECT $1, $2, s.id, NULL, now() + interval '1 day', now() + interval '1 day 30 minutes', 'confirmed', s.price, 0, 'manual'
       FROM salon_services s WHERE s.salon_id = $1 LIMIT 1`,
      [salonId, customerId],
    );

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/subscription/overrides`)
      .set('Cookie', adminCookie)
      .send({ overrides: { smsMonthlyQuota: 2 } })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /salons/mine/sms-quota', () => {
    it('reports the overridden quota with nothing used yet', async () => {
      const res = await request(app.getHttpServer()).get('/api/salons/mine/sms-quota').set('Cookie', ownerCookie).expect(200);
      expect(res.body).toEqual({ quota: 2, used: 0, remaining: 2 });
    });

    it('rejects an unauthenticated caller', () => request(app.getHttpServer()).get('/api/salons/mine/sms-quota').expect(401));
  });

  describe('POST /salons/mine/customers/:customerId/sms', () => {
    it('404s for a customer who never booked at this salon (ownership isolation)', async () => {
      const stranger = await loginAs(app, '09161110003');
      const strangerMe = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', stranger).expect(200);
      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${strangerMe.body.id}/sms`)
        .set('Cookie', ownerCookie)
        .send({ message: 'سلام' })
        .expect(404);
    });

    it('rejects an empty message', () =>
      request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/sms`)
        .set('Cookie', ownerCookie)
        .send({ message: '' })
        .expect(400));

    it('sends, logs the message, and decrements remaining quota', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/sms`)
        .set('Cookie', ownerCookie)
        .send({ message: 'یادآوری نوبت فردا شما' })
        .expect(201);
      expect(res.body).toEqual({ quota: 2, used: 1, remaining: 1 });

      const [row] = await ds.query(`SELECT message, customer_id, salon_id FROM salon_sms_messages WHERE salon_id = $1`, [salonId]);
      expect(row).toMatchObject({ message: 'یادآوری نوبت فردا شما', customer_id: customerId, salon_id: salonId });
    });

    it('409s once the quota is exhausted, without logging another row', async () => {
      // Second send consumes the last remaining unit from the quota=2 override.
      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/sms`)
        .set('Cookie', ownerCookie)
        .send({ message: 'پیام دوم' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/sms`)
        .set('Cookie', ownerCookie)
        .send({ message: 'پیام سوم -- نباید ارسال شود' })
        .expect(409);

      const [{ count }] = await ds.query(`SELECT COUNT(*) FROM salon_sms_messages WHERE salon_id = $1`, [salonId]);
      expect(Number(count)).toBe(2);

      const quota = await request(app.getHttpServer()).get('/api/salons/mine/sms-quota').set('Cookie', ownerCookie).expect(200);
      expect(quota.body).toEqual({ quota: 2, used: 2, remaining: 0 });
    });

    it('another salon owner cannot send to a customer that is not theirs', async () => {
      const otherOwnerCookie = await loginAs(app, '09161110004');
      await request(app.getHttpServer())
        .post(`/api/salons/mine/customers/${customerId}/sms`)
        .set('Cookie', otherOwnerCookie)
        .send({ message: 'نفوذ' })
        .expect(404); // no salon of their own at all -- SalonOwnerGuard 404s first
    });

    it('rejects an unauthenticated caller', () =>
      request(app.getHttpServer()).post(`/api/salons/mine/customers/${customerId}/sms`).send({ message: 'سلام' }).expect(401));
  });

  // CustomerSmsService.send's own doc comment calls this out explicitly: the
  // check-then-send-then-insert sequence has NO row lock and NO transaction wrapping the
  // three steps -- an ACCEPTED, DOCUMENTED MVP simplification (unlike every other
  // money-critical race in this codebase), because overrunning an SMS quota by one message
  // during a human owner's own manual, low-frequency action costs a fraction of a cent.
  // This test pins the REAL, currently-unlocked behaviour under genuine concurrency -- it is
  // NOT asserting a stricter guarantee than the code provides, and this is NOT a bug to fix.
  describe('concurrency: quota=1, two simultaneous sends at the boundary (KNOWN, ACCEPTED unlocked race)', () => {
    it('both requests can pass the check-then-send race, allowing usage to exceed the quota by one', async () => {
      const raceOwnerCookie = await loginAs(app, '09161110006');
      const { salonId: raceSalonId } = await createApprovedSalonWithService(
        app,
        raceOwnerCookie,
        { name: 'SMS Race Salon' },
        { price: 400_000 },
      );

      const raceCustomerCookie = await loginAs(app, '09161110007');
      const raceCustomerMe = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', raceCustomerCookie).expect(200);
      const raceCustomerId = raceCustomerMe.body.id;
      await ds.query(
        `INSERT INTO bookings (salon_id, user_id, service_id, worker_id, starts_at, ends_at, status, price_snapshot, deposit_amount, source)
         SELECT $1, $2, s.id, NULL, now() + interval '1 day', now() + interval '1 day 30 minutes', 'confirmed', s.price, 0, 'manual'
         FROM salon_services s WHERE s.salon_id = $1 LIMIT 1`,
        [raceSalonId, raceCustomerId],
      );

      await request(app.getHttpServer())
        .patch(`/api/admin/salons/${raceSalonId}/subscription/overrides`)
        .set('Cookie', adminCookie)
        .send({ overrides: { smsMonthlyQuota: 1 } })
        .expect(200);

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/salons/mine/customers/${raceCustomerId}/sms`)
          .set('Cookie', raceOwnerCookie)
          .send({ message: 'پیام همزمان یک' }),
        request(app.getHttpServer())
          .post(`/api/salons/mine/customers/${raceCustomerId}/sms`)
          .set('Cookie', raceOwnerCookie)
          .send({ message: 'پیام همزمان دو' }),
      ]);

      const statuses = [first.status, second.status].sort();
      // At least one must succeed; with no lock, both racing past the read-then-write
      // check before either's INSERT commits is a real, reachable outcome -- ground truth
      // is the actual row count logged below, not the HTTP statuses alone.
      expect(statuses[0]).toBe(201);
      expect([201, 409]).toContain(statuses[1]);

      const [{ count }] = await ds.query(`SELECT COUNT(*) FROM salon_sms_messages WHERE salon_id = $1`, [raceSalonId]);
      const logged = Number(count);
      // Pin the actually-observed outcome of the unlocked race: as many rows are logged as
      // requests that got a 201, which can legitimately be 2 against a quota of 1 -- this is
      // the documented, accepted over-quota-by-one behaviour, not an assertion that it must
      // happen every single run (a very unlucky interleaving could still serialize both).
      const succeededCount = [first, second].filter((r) => r.status === 201).length;
      expect(logged).toBe(succeededCount);

      const quotaStatus = await request(app.getHttpServer())
        .get('/api/salons/mine/sms-quota')
        .set('Cookie', raceOwnerCookie)
        .expect(200);
      expect(quotaStatus.body.used).toBe(succeededCount);
    });
  });

  describe('a salon on the plain default plan (no override applied)', () => {
    it('gets the migration-seeded placeholder quota, not zero', async () => {
      const otherOwnerCookie = await loginAs(app, '09161110005');
      await createApprovedSalonWithService(app, otherOwnerCookie, { name: 'Default Quota Salon' }, { price: 300_000 });

      const res = await request(app.getHttpServer()).get('/api/salons/mine/sms-quota').set('Cookie', otherOwnerCookie).expect(200);
      expect(res.body).toEqual({ quota: 20, used: 0, remaining: 20 });
    });
  });
});
