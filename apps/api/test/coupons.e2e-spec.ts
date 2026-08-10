import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Coupons (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let categoryId: number;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09125551001');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Coupon Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
      categoryIds: [categoryId],
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId, name: 'Cut', price: 2000000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09126662002');
  });

  afterAll(async () => {
    await app.close();
  });

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  describe('salon-scoped coupon lifecycle', () => {
    let couponId: string;

    it('creates a salon-scoped coupon as the provider', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'welcome10', discountPercent: 10 })
        .expect(201);
      couponId = res.body.id;
      // Codes are normalized uppercase on write.
      expect(res.body.code).toBe('WELCOME10');
      expect(res.body.salonId).toBe(salonId);
      expect(res.body.isActive).toBe(true);
    });

    it('rejects creating a second coupon with the same code (case-insensitive, globally unique)', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'Welcome10', discountPercent: 15 })
        .expect(409));

    it('lists the salon\'s own coupons with a redeemedCount', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(couponId);
      expect(res.body[0].redeemedCount).toBe(0);
    });

    it('previews the coupon via POST /coupons/validate without consuming it', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', customerCookie)
        .send({ code: 'welcome10', salonId, serviceId })
        .expect(201);
      expect(res.body).toMatchObject({
        valid: true,
        couponDiscountPercent: 10,
        serviceDiscountPercent: null,
        appliedDiscountPercent: 10,
        originalPrice: 2000000,
        finalPrice: 1800000,
      });
      expect(res.body.estimatedDeposit).toBeGreaterThan(0);
    });

    it('books with the coupon code and reflects the discount on the booking', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(24), couponCode: 'welcome10' })
        .expect(201);

      const booking = res.body.booking;
      expect(booking.priceSnapshot).toBe(1800000); // 2,000,000 - 10%
      expect(booking.discountPercent).toBe(10);
      expect(booking.originalPriceSnapshot).toBe(2000000);
      // Deposit is computed off the DISCOUNTED price: 20% of 1,800,000 = 360,000,
      // comfortably above the seeded 200,000 floor.
      expect(booking.depositAmount).toBe(360000);
    });

    it('rejects booking again with the same code as the same user (already redeemed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(48), couponCode: 'welcome10' })
        .expect(400);
      // Machine-readable code alongside the Persian message -- see coupon-error-codes.ts.
      expect(res.body.code).toBe('COUPON_ALREADY_REDEEMED');
    });

    it('rejects the preview endpoint for the same already-used code too', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', customerCookie)
        .send({ code: 'welcome10', salonId, serviceId })
        .expect(400);
      expect(res.body.code).toBe('COUPON_ALREADY_REDEEMED');
    });

    it('a different customer can still redeem the same code once', async () => {
      const otherCustomer = await loginAs(app, '09127773003');
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', otherCustomer)
        .send({ salonId, serviceId, startsAt: futureIso(72), couponCode: 'welcome10' })
        .expect(201);
      expect(res.body.booking.discountPercent).toBe(10);
    });

    it('now reports a redeemedCount of 2', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salons/mine/coupons')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(res.body[0].redeemedCount).toBe(2);
    });

    it('deactivates the coupon, after which it is rejected as invalid', async () => {
      await request(app.getHttpServer())
        .delete(`/api/salons/mine/coupons/${couponId}`)
        .set('Cookie', ownerCookie)
        .expect(204);

      const freshCustomer = await loginAs(app, '09128884004');
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', freshCustomer)
        .send({ code: 'welcome10', salonId, serviceId })
        .expect(400);
      expect(res.body.code).toBe('COUPON_INVALID');
    });

    it('rejects a provider trying to touch another salon\'s coupon id via a fresh scoped coupon', async () => {
      // Create a second salon owned by a different provider, with its own coupon,
      // then confirm the first owner cannot update/delete it (404, correctly scoped).
      const otherOwnerCookie = await loginAs(app, '09129995005');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
        name: 'Other Salon',
        genderTarget: 'men',
        address: 'Elsewhere St, No. 2',
        city: 'Tehran',
        lat: 35.71,
        lng: 51.41,
        categoryIds: [categoryId],
      });
      const otherCouponRes = await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', otherOwnerCookie)
        .send({ code: 'OTHERSALON5', discountPercent: 5 })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/coupons/${otherCouponRes.body.id}`)
        .set('Cookie', ownerCookie)
        .send({ discountPercent: 50 })
        .expect(404);
    });
  });

  describe('platform-wide coupon (admin)', () => {
    it('rejects a non-admin creating a platform-wide coupon', () =>
      request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Cookie', ownerCookie)
        .send({ code: 'PLATFORM20', discountPercent: 20 })
        .expect(403));

    it('creates and uses a platform-wide coupon across an unrelated salon', async () => {
      const adminCookie = await loginAsAdmin(app, '09121110000');
      const res = await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Cookie', adminCookie)
        .send({ code: 'PLATFORM20', discountPercent: 20 })
        .expect(201);
      expect(res.body.salonId).toBeNull();

      const platformCustomer = await loginAs(app, '09121114444');
      const bookingRes = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', platformCustomer)
        .send({ salonId, serviceId, startsAt: futureIso(96), couponCode: 'platform20' })
        .expect(201);
      expect(bookingRes.body.booking.discountPercent).toBe(20);
      expect(bookingRes.body.booking.priceSnapshot).toBe(1600000); // 2,000,000 - 20%
    });
  });

  describe('service discount + coupon: larger single percentage wins, no stacking', () => {
    it('a service discount larger than the coupon wins', async () => {
      const discountedServiceRes = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', ownerCookie)
        .send({ categoryId: (await request(app.getHttpServer()).get('/api/categories').expect(200)).body[0].id, name: 'Color', price: 1000000, durationMin: 90, discountPercent: 30 })
        .expect(201);
      const discountedServiceId = discountedServiceRes.body.id;
      expect(discountedServiceRes.body.discountPercent).toBe(30);

      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Cookie', await loginAsAdmin(app, '09121110000'))
        .send({ code: 'SMALL5', discountPercent: 5 })
        .expect(201);

      const stackCustomer = await loginAs(app, '09121119999');
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', stackCustomer)
        .send({ salonId, serviceId: discountedServiceId, startsAt: futureIso(120), couponCode: 'small5' })
        .expect(201);

      // max(30, 5) = 30 -- never 35 (no stacking/multiplying).
      expect(res.body.booking.discountPercent).toBe(30);
      expect(res.body.booking.priceSnapshot).toBe(700000); // 1,000,000 - 30%
    });
  });

  // resolveAndValidate's own already-redeemed pre-check is a best-effort read that two
  // concurrent requests can both pass -- UNIQUE(coupon_id, user_id) is the real backstop
  // (see bookings.service.spec.ts's mocked proof that the resulting duplicate-key error
  // is translated into COUPON_ALREADY_REDEEMED). This is the real-Postgres version: two
  // genuinely concurrent bookings, same user, same code, against two DIFFERENT salons so
  // createHold's own per-salon Redis lock can't be what serializes them -- only the DB
  // constraint can.
  describe('concurrency: same coupon code, same user, two different salons at once', () => {
    it('redeems the code exactly once -- the loser gets the ordinary already-redeemed rejection, not a 500', async () => {
      const owner2Cookie = await loginAs(app, '09125559991');
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      const salon2Res = await request(app.getHttpServer()).post('/api/salons').set('Cookie', owner2Cookie).send({
        name: 'Coupon Race Salon 2',
        genderTarget: 'women',
        address: 'Somewhere St, No. 2',
        city: 'Tehran',
        lat: 35.71,
        lng: 51.41,
        capacity: 5,
        categoryIds: [categoriesRes.body[0].id],
      });
      const salon2Id = salon2Res.body.id;

      const service2Res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', owner2Cookie)
        .send({ categoryId: categoriesRes.body[0].id, name: 'Cut 2', price: 1000000, durationMin: 60 });
      const service2Id = service2Res.body.id;

      const ds = app.get(DataSource);
      await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salon2Id]);
      await ds.query(
        `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
         SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
        [salon2Id],
      );

      await request(app.getHttpServer())
        .post('/api/admin/coupons')
        .set('Cookie', await loginAsAdmin(app, '09121110000'))
        .send({ code: 'RACE10', discountPercent: 10 })
        .expect(201);

      const racer = await loginAs(app, '09121119998');

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/bookings')
          .set('Cookie', racer)
          .send({ salonId, serviceId, startsAt: futureIso(144), couponCode: 'RACE10' }),
        request(app.getHttpServer())
          .post('/api/bookings')
          .set('Cookie', racer)
          .send({ salonId: salon2Id, serviceId: service2Id, startsAt: futureIso(144), couponCode: 'RACE10' }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 400]);
      const loser = [first, second].find((r) => r.status === 400)!;
      expect(loser.body.code).toBe('COUPON_ALREADY_REDEEMED');

      const winner = [first, second].find((r) => r.status === 201)!;
      expect(winner.body.couponApplied).toBe(true);

      const redemptions = await ds.query(`SELECT cr.id FROM coupon_redemptions cr JOIN coupons c ON c.id = cr.coupon_id WHERE c.code = 'RACE10'`);
      expect(redemptions).toHaveLength(1);
    });
  });
});
