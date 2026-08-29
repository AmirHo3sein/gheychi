import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReferralGrantJob } from '../src/booking/referral-grant.job';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Referral discount-kind (percent_discount) rewards via literal coupon rows (e2e, Slice 5, Piece 1)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  const ADMIN_PHONE = '09151000099';
  const OWNER_PHONE = '09151000001';

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);
    ownerCookie = await loginAs(app, OWNER_PHONE);

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Referral Discount Test Salon',
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
      .send({ categoryId, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function getMyCode(cookie: string): Promise<string> {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cookie).expect(200);
    return res.body.code;
  }

  /** Books, pays (via the mock gateway), and confirms a booking for `cookie`. */
  async function bookAndConfirm(
    cookie: string,
    hoursFromNow = 48,
    couponCode?: string,
  ): Promise<{ bookingId: string }> {
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

  /** Just creates the hold (pending_payment) -- does not pay. Enough to consume a coupon redemption. */
  async function createHoldOnly(cookie: string, hoursFromNow: number, couponCode: string): Promise<{ bookingId: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', cookie)
      .send({
        salonId,
        serviceId,
        startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString(),
        couponCode,
      })
      .expect(201);
    return { bookingId: created.body.booking.id };
  }

  async function markCompleted(bookingId: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${bookingId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
  }

  describe('1. Full grant, both sides -- wallet_credit referrer + percent_discount referred (the actual default seed)', () => {
    const REFERRER_PHONE = '09151000010';
    const REFERRED_PHONE = '09151000011';
    const STRANGER_PHONE = '09151000012';
    let referrerCookie: string;
    let referredCookie: string;
    let strangerCookie: string;
    let referralId: string;
    let couponCode: string;

    it('admin enables the user type matching the default seed shape, with a cap on the discount', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 8000,
          // Matches the actual seeded default kind -- referred_reward_kind stays
          // percent_discount. Value set above referredRewardMax to prove capping
          // applies to the discount percent too.
          referredRewardKind: 'percent_discount',
          referredRewardValue: 30,
          referredRewardMax: 15,
          qualifyingEvent: 'first_completed_booking',
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      referralId = mine.body.items[0].id;
    });

    it('completing the qualifying booking now grants BOTH sides -- the referral completes to reward_granted for the first time end-to-end', async () => {
      const { bookingId } = await bookAndConfirm(referredCookie);
      await markCompleted(bookingId);

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      const row = mine.body.items.find((r: { id: string }) => r.id === referralId);
      expect(row.status).toBe('reward_granted'); // NOT partially_granted -- Slice 4's gap is closed
      expect(row.rewardGrantedAt).not.toBeNull();
    });

    it('the referrer was credited the wallet_credit side as before', async () => {
      const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.balances).toContainEqual({ currency: 'toman', balance: 8000 });
    });

    it("the referred user's rewards list shows a granted percent_discount coupon, capped at 15 (not the raw 30)", async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referredCookie).expect(200);
      expect(res.body.total).toBe(1);
      const item = res.body.items[0];
      expect(item).toMatchObject({
        beneficiaryRole: 'referred',
        rewardKind: 'percent_discount',
        rewardValue: 15, // reward_max capping applied to the discount percent
        status: 'granted',
        walletTransactionId: null,
        currency: null,
      });
      expect(item.couponCode).toMatch(/^REF-[A-Z0-9]{8}$/);
      couponCode = item.couponCode;
    });

    it('the issued coupon is real and usable: POST /coupons/validate succeeds for the referred user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', referredCookie)
        .send({ code: couponCode, salonId, serviceId })
        .expect(201);
      expect(res.body).toMatchObject({ valid: true, couponDiscountPercent: 15 });
    });

    it('the same coupon is rejected for a different user, without leaking that it exists', async () => {
      strangerCookie = await loginAs(app, STRANGER_PHONE);
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', strangerCookie)
        .send({ code: couponCode, salonId, serviceId })
        .expect(400);
      expect(res.body.message).toBe('کد تخفیف نامعتبر است');
    });

    it('a live attempt to actually BOOK with the referral coupon as a different user is rejected too, not just the preview endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', strangerCookie)
        .send({
          salonId,
          serviceId,
          startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
          couponCode,
        })
        .expect(400);
      expect(res.body.message).toBe('کد تخفیف نامعتبر است');
    });

    it("the referrer's own rewards list still shows one wallet_credit row (both sides visible independently)", async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ beneficiaryRole: 'referrer', rewardKind: 'wallet_credit', rewardValue: 8000 });
    });

    it('GET /admin/referrals/:id/rewards is cross-checked field-by-field against the raw referral_rewards/coupons/wallet_transactions rows, not just trusted as-is', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/referrals/${referralId}/rewards`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body).toHaveLength(2);

      const dbRows = await ds.query(
        `SELECT rr.id, rr.beneficiary_role, rr.reward_kind, rr.reward_value, rr.status,
                rr.wallet_transaction_id, rr.coupon_id, c.code AS coupon_code, c.is_active AS coupon_is_active,
                c.issued_to_user_id, wt.amount AS wallet_amount
         FROM referral_rewards rr
         LEFT JOIN coupons c ON c.id = rr.coupon_id
         LEFT JOIN wallet_transactions wt ON wt.id = rr.wallet_transaction_id
         WHERE rr.referral_id = $1`,
        [referralId],
      );
      expect(dbRows).toHaveLength(2);

      for (const apiRow of res.body as Array<Record<string, unknown>>) {
        const dbRow = dbRows.find((r: { id: string }) => r.id === apiRow.id);
        expect(dbRow).toBeDefined();
        expect(apiRow.beneficiaryRole).toBe(dbRow.beneficiary_role);
        expect(apiRow.rewardKind).toBe(dbRow.reward_kind);
        expect(Number(apiRow.rewardValue)).toBe(Number(dbRow.reward_value));
        expect(apiRow.status).toBe(dbRow.status);
        expect(apiRow.walletTransactionId).toBe(dbRow.wallet_transaction_id);
        expect(apiRow.couponId).toBe(dbRow.coupon_id);
        expect(apiRow.couponCode).toBe(dbRow.coupon_code);
        expect(apiRow.couponIsActive).toBe(dbRow.coupon_is_active);
        if (dbRow.reward_kind === 'percent_discount') {
          // The coupon really is restricted to the referred user in the DB itself,
          // not just claimed to be by the endpoint.
          expect(dbRow.issued_to_user_id).not.toBeNull();
        }
        if (dbRow.wallet_transaction_id) {
          expect(Number(dbRow.wallet_amount)).toBe(Number(apiRow.rewardValue));
        }
      }
    });
  });

  describe('2. Reversal -- an UNREDEEMED discount coupon is voided when the qualifying payment is refunded', () => {
    const REFERRER_PHONE = '09151000020';
    const REFERRED_PHONE = '09151000021';
    let referrerCookie: string;
    let referredCookie: string;
    let bookingId: string;
    let referralId: string;
    let couponCode: string;

    it('enables first_paid_booking with a zero hold-back so the sweep can act immediately', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 5000,
          referredRewardKind: 'percent_discount',
          referredRewardValue: 10,
          referredRewardMax: null,
          qualifyingEvent: 'first_paid_booking',
          grantHoldbackHours: 0,
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      referralId = mine.body.items[0].id;
    });

    it('grants both sides once the sweep runs after the booking is paid', async () => {
      const created = await bookAndConfirm(referredCookie);
      bookingId = created.bookingId;

      const job = app.get(ReferralGrantJob);
      await job.run();

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      const row = mine.body.items.find((r: { id: string }) => r.id === referralId);
      expect(row.status).toBe('reward_granted');

      const rewards = await request(app.getHttpServer())
        .get('/api/referrals/mine/rewards')
        .set('Cookie', referredCookie)
        .expect(200);
      couponCode = rewards.body.items[0].couponCode;
      expect(couponCode).toMatch(/^REF-/);
    });

    it('the coupon is confirmed usable BEFORE the reversal', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', referredCookie)
        .send({ code: couponCode, salonId, serviceId })
        .expect(201);
      expect(res.body.valid).toBe(true);
    });

    it('cancelling + refunding the qualifying booking voids the still-unredeemed coupon', async () => {
      await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', referredCookie).expect(200);

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('refunded');

      const [couponRow] = await ds.query('SELECT is_active FROM coupons WHERE code = $1', [couponCode]);
      expect(couponRow.is_active).toBe(false);
    });

    it('the voided coupon now fails validation for anyone, including its original recipient', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/coupons/validate')
        .set('Cookie', referredCookie)
        .send({ code: couponCode, salonId, serviceId })
        .expect(400);
      expect(res.body.message).toBe('کد تخفیف نامعتبر است');
    });

    it("the admin rewards-detail endpoint shows the discount side reversed", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/referrals/${referralId}/rewards`)
        .set('Cookie', adminCookie)
        .expect(200);
      const discountReward = res.body.find((r: { rewardKind: string }) => r.rewardKind === 'percent_discount');
      expect(discountReward).toMatchObject({ status: 'reversed', couponCode });
      expect(discountReward.reversedAt).not.toBeNull();
    });
  });

  describe('3. Reversal -- an ALREADY-REDEEMED discount coupon is left un-reversed, no alert fired', () => {
    const REFERRER_PHONE = '09151000030';
    const REFERRED_PHONE = '09151000031';
    let referrerCookie: string;
    let referredCookie: string;
    let bookingId: string;
    let referralId: string;
    let couponCode: string;
    let notificationCountBefore: number;

    it('enables first_paid_booking with a zero hold-back', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 5000,
          referredRewardKind: 'percent_discount',
          referredRewardValue: 10,
          referredRewardMax: null,
          qualifyingEvent: 'first_paid_booking',
          grantHoldbackHours: 0,
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      referralId = mine.body.items[0].id;
    });

    it('grants both sides, then the referred user REDEEMS the coupon on a second, distinct booking', async () => {
      const created = await bookAndConfirm(referredCookie);
      bookingId = created.bookingId;

      const job = app.get(ReferralGrantJob);
      await job.run();

      const rewards = await request(app.getHttpServer())
        .get('/api/referrals/mine/rewards')
        .set('Cookie', referredCookie)
        .expect(200);
      couponCode = rewards.body.items[0].couponCode;

      // A second, distinct booking that actually consumes the coupon (inserts a
      // coupon_redemptions row at hold-creation time) -- this is what makes the
      // ORIGINAL qualifying booking's later reversal hit the "already redeemed"
      // branch rather than the "unredeemed -> void it" branch.
      await createHoldOnly(referredCookie, 96, couponCode);

      const [redemption] = await ds.query(
        `SELECT 1 FROM coupon_redemptions cr JOIN coupons c ON c.id = cr.coupon_id WHERE c.code = $1`,
        [couponCode],
      );
      expect(redemption).toBeDefined();
    });

    it('cancelling + refunding the ORIGINAL qualifying booking leaves the already-redeemed coupon untouched, with no new admin notification', async () => {
      const [{ count: before }] = await ds.query(`SELECT COUNT(*)::int AS count FROM admin_notifications`);
      notificationCountBefore = Number(before);

      await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', referredCookie).expect(200);

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('refunded');

      // The wallet side (referrer) still reverses normally -- independent of the
      // discount side's non-reversibility.
      const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(wallet.body.balances).toContainEqual({ currency: 'toman', balance: 0 });

      const [couponRow] = await ds.query('SELECT is_active FROM coupons WHERE code = $1', [couponCode]);
      expect(couponRow.is_active).toBe(true); // NOT voided -- already redeemed, non-reversible (Product Decision 8)

      const [{ count: after }] = await ds.query(`SELECT COUNT(*)::int AS count FROM admin_notifications`);
      expect(Number(after)).toBe(notificationCountBefore); // no new notification for this accepted, bounded case
    });

    it("the admin rewards-detail endpoint shows the honest marker: status still 'granted', reversal_reason set, reversed_at null", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/referrals/${referralId}/rewards`)
        .set('Cookie', adminCookie)
        .expect(200);
      const discountReward = res.body.find((r: { rewardKind: string }) => r.rewardKind === 'percent_discount');
      expect(discountReward.status).toBe('granted');
      expect(discountReward.reversedAt).toBeNull();
      expect(discountReward.reversalReason).toBe('غیرقابل بازگشت -- کد از قبل استفاده شده');
      expect(discountReward.couponCode).toBe(couponCode);
      expect(discountReward.couponIsActive).toBe(true);
    });
  });
});
