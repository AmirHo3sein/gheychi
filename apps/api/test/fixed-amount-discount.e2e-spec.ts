import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Slice 6 (spec section 2/3/10) -- fixed_discount reward kind end-to-end:
//   1. a referral configured for fixed_discount actually grants a real coupon
//      carrying coupons.discount_fixed_amount (not an approximated percent);
//   2. applying it at booking time produces the mathematically correct finalPrice;
//   3. resolveBestPrice's cross-kind comparison is really wired into
//      BookingsService.createHold, not just unit-tested in isolation -- proven with
//      one case where the fixed coupon wins and one where the service's own percent
//      discount wins, at the same coupon value;
//   4. referral-issued coupons never leak into the manual coupon-management lists
//      (GET /salons/mine/coupons, GET /admin/coupons), even when their salon_id
//      matches the caller's own salon.
describe('Fixed-amount discount support (e2e, Slice 6)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let plainServiceId: string; // no service-level discount
  let percentWinsServiceId: string; // 40% off -- beats a 200,000 fixed coupon
  let fixedWinsServiceId: string; // 5% off -- loses to a 200,000 fixed coupon

  const ADMIN_PHONE = '09152000099';
  const OWNER_PHONE = '09152000001';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);
    ownerCookie = await loginAs(app, OWNER_PHONE);

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Fixed Discount Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    async function createService(name: string, price: number, discountPercent?: number): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', ownerCookie)
        .send({ categoryId, name, price, durationMin: 60, ...(discountPercent ? { discountPercent } : {}) });
      return res.body.id;
    }

    plainServiceId = await createService('Plain Cut', 1000000);
    percentWinsServiceId = await createService('Color (big discount)', 1000000, 40);
    fixedWinsServiceId = await createService('Blowout (small discount)', 1000000, 5);

    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    // salon_owner-type referral: fixed_discount on the REFERRED side. Reused across
    // most of this file so the owner can refer several people without hitting any
    // cap (max_referrals_per_referrer stays null).
    await request(app.getHttpServer())
      .patch('/api/admin/referral-reward-types/salon_owner')
      .set('Cookie', adminCookie)
      .send({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 10000,
        referredRewardKind: 'fixed_discount',
        referredRewardValue: 200000,
        referredRewardMax: 250000, // above the value -- proves capping doesn't kick in unnecessarily
        qualifyingEvent: 'first_completed_booking',
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function getMyCode(cookie: string): Promise<string> {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cookie).expect(200);
    return res.body.code;
  }

  async function bookAndConfirm(cookie: string, serviceId: string, hoursFromNow: number, couponCode?: string): Promise<{ bookingId: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', cookie)
      .send({
        salonId,
        serviceId,
        startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString(),
        ...(couponCode ? { couponCode } : {}),
      })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    return { bookingId: created.body.booking.id };
  }

  async function markCompleted(bookingId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
  }

  /** Refers `phone` under the owner's salon_owner-type code and grants the reward via a plain-service completed booking. Returns the resulting fixed_discount coupon code. */
  async function referAndGrantFixedDiscount(phone: string): Promise<string> {
    const code = await getMyCode(ownerCookie);
    const { cookie } = await verifyOtpAndLogin(app, phone, { referralCode: code });
    const { bookingId } = await bookAndConfirm(cookie, plainServiceId, 24);
    await markCompleted(bookingId);

    const rewards = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', cookie).expect(200);
    const discountReward = rewards.body.items.find((i: { rewardKind: string }) => i.rewardKind === 'fixed_discount');
    expect(discountReward).toBeDefined();
    return discountReward.couponCode;
  }

  describe('1. Full grant + real fixed-toman coupon end-to-end', () => {
    const REFERRED_PHONE = '09152000011';
    let referredCookie: string;
    let couponCode: string;
    let referralId: string;

    it('registers under the code and completes the qualifying booking -- referral reaches reward_granted', async () => {
      const code = await getMyCode(ownerCookie);
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const { bookingId } = await bookAndConfirm(referredCookie, plainServiceId, 24);
      await markCompleted(bookingId);

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', ownerCookie).expect(200);
      // This is the very first referral created under the owner's code in this
      // describe block, so it's the only item in the list at this point.
      expect(mine.body.items).toHaveLength(1);
      const row = mine.body.items[0];
      referralId = row.id;
      expect(row.status).toBe('reward_granted');
    });

    it("the referred user's reward is a fixed_discount coupon carrying the literal toman amount, not an approximated percent", async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referredCookie).expect(200);
      const item = res.body.items.find((i: { rewardKind: string }) => i.rewardKind === 'fixed_discount');
      expect(item).toMatchObject({
        beneficiaryRole: 'referred',
        rewardKind: 'fixed_discount',
        rewardValue: 200000,
        status: 'granted',
        walletTransactionId: null,
        currency: null,
      });
      expect(item.couponCode).toMatch(/^REF-[A-Z0-9]{8}$/);
      couponCode = item.couponCode;
    });

    it('the raw DB row really has discount_fixed_amount set and discount_percent NULL', async () => {
      const rows = await ds.query(`SELECT discount_percent, discount_fixed_amount FROM coupons WHERE code = $1`, [couponCode]);
      expect(rows).toHaveLength(1);
      expect(rows[0].discount_percent).toBeNull();
      expect(Number(rows[0].discount_fixed_amount)).toBe(200000);
    });

    it('POST /coupons/validate reports the new discount-kind-aware fields correctly, with NO fabricated appliedDiscountPercent', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', referredCookie)
        .send({ code: couponCode, salonId, serviceId: plainServiceId })
        .expect(201);
      expect(res.body).toMatchObject({
        valid: true,
        couponDiscountKind: 'fixed',
        couponDiscountValue: 200000,
        couponDiscountPercent: null,
        serviceDiscountPercent: null,
        originalPrice: 1000000,
        finalPrice: 800000, // 1,000,000 - 200,000, computed by subtraction, not a percent
      });
      expect(res.body.appliedDiscountPercent).toBeUndefined();
    });

    it('booking with the coupon produces the mathematically correct finalPrice and records the fixed amount losslessly on the booking itself', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', referredCookie)
        .send({
          salonId,
          serviceId: plainServiceId,
          startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
          couponCode,
        })
        .expect(201);

      const booking = res.body.booking;
      expect(booking.priceSnapshot).toBe(800000); // 1,000,000 - 200,000
      expect(booking.discountFixedAmount).toBe(200000);
      expect(booking.discountPercent).toBeNull();
      expect(booking.originalPriceSnapshot).toBe(1000000);
    });

    it("referral-issued coupon does NOT appear in the owner's own GET /salons/mine/coupons list, even though its salon_id matches the owner's salon", async () => {
      const res = await request(app.getHttpServer()).get('/api/salons/mine/coupons').set('Cookie', ownerCookie).expect(200);
      expect(res.body.find((c: { code: string }) => c.code === couponCode)).toBeUndefined();

      // Prove it's excluded by the filter, not because it doesn't exist / isn't
      // salon-scoped -- confirm the raw row really does have this salon's id.
      const rows = await ds.query(`SELECT salon_id, issued_to_user_id FROM coupons WHERE code = $1`, [couponCode]);
      expect(rows[0].salon_id).toBe(salonId);
      expect(rows[0].issued_to_user_id).not.toBeNull();
    });

    it('the referral remains fully visible through the correct, purpose-built admin surface (GET /admin/referrals/:id/rewards)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/referrals/${referralId}/rewards`)
        .set('Cookie', adminCookie)
        .expect(200);
      const discountRow = res.body.find((r: { rewardKind: string }) => r.rewardKind === 'fixed_discount');
      expect(discountRow).toBeDefined();
      expect(discountRow.couponCode).toBe(couponCode);
    });
  });

  describe('2. resolveBestPrice really wired into the booking flow -- fixed vs percent, both directions', () => {
    it('percent wins when it produces the lower price (40% off 1,000,000 = 600,000 beats a 200,000 fixed coupon -> 800,000)', async () => {
      const couponCode = await referAndGrantFixedDiscount('09152000021');
      const cookie = await loginAs(app, '09152000021'); // already registered via the referral; loginAs against an existing user just re-authenticates
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', cookie)
        .send({
          salonId,
          serviceId: percentWinsServiceId,
          startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
          couponCode,
        })
        .expect(201);

      const booking = res.body.booking;
      expect(booking.priceSnapshot).toBe(600000); // 40% off wins over the 200,000 fixed coupon
      expect(booking.discountPercent).toBe(40);
      expect(booking.discountFixedAmount).toBeNull();
    });

    it('fixed wins when it produces the lower price (5% off 1,000,000 = 950,000 loses to a 200,000 fixed coupon -> 800,000)', async () => {
      const couponCode = await referAndGrantFixedDiscount('09152000022');
      const cookie = await loginAs(app, '09152000022');
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', cookie)
        .send({
          salonId,
          serviceId: fixedWinsServiceId,
          startsAt: new Date(Date.now() + 96 * 60 * 60_000).toISOString(),
          couponCode,
        })
        .expect(201);

      const booking = res.body.booking;
      expect(booking.priceSnapshot).toBe(800000); // the 200,000 fixed coupon wins over the 5% service discount
      expect(booking.discountFixedAmount).toBe(200000);
      expect(booking.discountPercent).toBeNull();
    });
  });

  describe('3. Platform-wide (user-type) fixed_discount referrer reward never leaks into GET /admin/coupons', () => {
    const REFERRER_PHONE = '09152000031';
    const REFERRED_PHONE = '09152000032';
    let referrerCookie: string;
    let couponCode: string;

    it('admin enables the user type with fixed_discount on the REFERRER side', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'fixed_discount',
          referrerRewardValue: 100000,
          referredRewardKind: 'wallet_credit',
          referredRewardValue: 5000,
          qualifyingEvent: 'first_completed_booking',
        })
        .expect(200);

      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);
      const { cookie } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });

      const { bookingId } = await bookAndConfirm(cookie, plainServiceId, 120);
      await markCompleted(bookingId);

      const rewards = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referrerCookie).expect(200);
      const item = rewards.body.items.find((i: { rewardKind: string }) => i.rewardKind === 'fixed_discount');
      expect(item).toBeDefined();
      expect(item.rewardValue).toBe(100000);
      couponCode = item.couponCode;
    });

    it('the coupon is real, platform-wide (salon_id NULL), yet absent from GET /admin/coupons', async () => {
      const rows = await ds.query(`SELECT id, salon_id, discount_fixed_amount FROM coupons WHERE code = $1`, [couponCode]);
      expect(rows).toHaveLength(1);
      expect(rows[0].salon_id).toBeNull();
      expect(Number(rows[0].discount_fixed_amount)).toBe(100000);

      const res = await request(app.getHttpServer()).get('/api/admin/coupons').set('Cookie', adminCookie).expect(200);
      expect(res.body.find((c: { code: string }) => c.code === couponCode)).toBeUndefined();
    });
  });
});
