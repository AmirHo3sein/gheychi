import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReferralGrantJob } from '../src/booking/referral-grant.job';
import { RefundRetryJob } from '../src/booking/refund-retry.job';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Referral reward granting + reversal (e2e, Slice 4)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  const ADMIN_PHONE = '09141000099';
  const OWNER_PHONE = '09141000001';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);
    ownerCookie = await loginAs(app, OWNER_PHONE);

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Referral Grant Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
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

  /** Books, pays (via the mock gateway), and confirms a booking for `cookie`. */
  async function bookAndConfirm(cookie: string, hoursFromNow = 48): Promise<{ bookingId: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', cookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
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

  async function getMyCode(cookie: string): Promise<string> {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cookie).expect(200);
    return res.body.code;
  }

  describe('1. Full happy path -- both sides wallet_credit, first_completed_booking', () => {
    const REFERRER_PHONE = '09141000010';
    const REFERRED_PHONE = '09141000011';
    let referrerCookie: string;
    let referredCookie: string;
    let referralId: string;

    it('sets up a referrer, enables BOTH sides as wallet_credit, and redeems the code at registration', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      // Slice 5 hasn't shipped discount-kind granting yet -- to prove full two-sided
      // granting actually works in THIS slice, the referred side is reconfigured to a
      // wallet-kind reward too (an admin can freely do this via the existing PATCH
      // endpoint). This is deliberately NOT the default seed (that's test 2 below).
      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 20000,
          referredRewardKind: 'wallet_credit',
          referredRewardValue: 15000,
          // first_completed_booking avoids needing to fast-forward R7's hold-back clock.
          qualifyingEvent: 'first_completed_booking',
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(mine.body.items[0].status).toBe('awaiting_qualifying_event');
      referralId = mine.body.items[0].id;
    });

    it('grants both sides the instant the referred user completes their first booking', async () => {
      const { bookingId } = await bookAndConfirm(referredCookie);
      await markCompleted(bookingId);

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      const row = mine.body.items.find((r: { id: string }) => r.id === referralId);
      expect(row.status).toBe('reward_granted');
      expect(row.rewardGrantedAt).not.toBeNull();
    });

    it('credits the referrer\'s wallet with 20000 toman', async () => {
      const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.balances).toContainEqual({ currency: 'toman', balance: 20000 });
    });

    it('credits the referred user\'s wallet with 15000 toman', async () => {
      const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referredCookie).expect(200);
      expect(res.body.balances).toContainEqual({ currency: 'toman', balance: 15000 });
    });

    it('the referrer\'s own rewards list shows one granted wallet_credit row', async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        beneficiaryRole: 'referrer',
        rewardKind: 'wallet_credit',
        rewardValue: 20000,
        status: 'granted',
        currency: 'toman',
        couponCode: null,
      });
      expect(res.body.items[0].walletTransactionId).toEqual(expect.any(String));
    });

    it('the referred user\'s own rewards list shows one granted wallet_credit row too', async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referredCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        beneficiaryRole: 'referred',
        rewardKind: 'wallet_credit',
        rewardValue: 15000,
        status: 'granted',
      });
    });
  });

  describe('2. The actual default seed (referrer=wallet_credit, referred=percent_discount) -- now a FULL grant as of Slice 5', () => {
    // Originally a Slice 4 "partial grant" regression test (percent_discount was not
    // yet grantable, so this scenario only credited the referrer side and left the
    // referral 'partially_granted'). Slice 5 ships coupon-based granting for
    // percent_discount (spec section 2/3/10, rollout item 5) -- this scenario now
    // completes to a full 'reward_granted' on the very first pass. See
    // test/referral-discount-coupons.e2e-spec.ts for the full Slice 5 coverage
    // (coupon usability/restriction, reward_max capping, both reversal branches);
    // this block is kept as a lighter sanity check that the default seed itself
    // (exactly what an admin sees on a fresh install) fully grants without error.
    const REFERRER_PHONE = '09141000020';
    const REFERRED_PHONE = '09141000021';
    let referrerCookie: string;
    let referredCookie: string;

    it('enables the user type with referrer=wallet_credit, leaving referred at the seeded percent_discount', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 8000,
          // Explicitly restated to the seed's own default value (not left over from
          // test 1's override).
          referredRewardKind: 'percent_discount',
          referredRewardValue: 10,
          qualifyingEvent: 'first_completed_booking',
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');
    });

    it('completing the qualifying booking now grants BOTH sides -- reward_granted, not partially_granted', async () => {
      const { bookingId } = await bookAndConfirm(referredCookie);
      await markCompleted(bookingId); // must not throw / 500 -- tryGrantReward runs inline here

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(mine.body.items[0].status).toBe('reward_granted');
      expect(mine.body.items[0].rewardGrantedAt).not.toBeNull();
    });

    it('the referrer was credited the wallet_credit side', async () => {
      const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.balances).toContainEqual({ currency: 'toman', balance: 8000 });
    });

    it('the referred side (percent_discount) was granted as a real coupon -- no crash, no longer a no-op', async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referredCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ beneficiaryRole: 'referred', rewardKind: 'percent_discount', rewardValue: 10 });
      expect(res.body.items[0].couponCode).toMatch(/^REF-/);
    });

    it('the referrer\'s rewards list shows exactly its own one granted side', async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine/rewards').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].beneficiaryRole).toBe('referrer');
    });
  });

  describe('3. Reversal -- a granted wallet reward is clawed back when the qualifying payment is later refunded', () => {
    const REFERRER_PHONE = '09141000030';
    const REFERRED_PHONE = '09141000031';
    let referrerCookie: string;
    let referredCookie: string;
    let bookingId: string;

    it('enables first_paid_booking with a zero hold-back so the grant sweep can act immediately', async () => {
      referrerCookie = await loginAs(app, REFERRER_PHONE);
      const code = await getMyCode(referrerCookie);

      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 12000,
          referredRewardKind: 'percent_discount',
          referredRewardValue: 10,
          qualifyingEvent: 'first_paid_booking',
          grantHoldbackHours: 0,
        })
        .expect(200);

      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED_PHONE, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');
    });

    it('grants the referrer once the sweep job runs after the booking is paid', async () => {
      const created = await bookAndConfirm(referredCookie);
      bookingId = created.bookingId;

      const job = app.get(ReferralGrantJob);
      const attempted = await job.run();
      expect(attempted).toBeGreaterThanOrEqual(1);

      const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.balances).toContainEqual({ currency: 'toman', balance: 12000 });

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(['partially_granted', 'reward_granted']).toContain(mine.body.items[0].status);

      const [referralRow] = await ds.query('SELECT qualifying_booking_id FROM referrals WHERE id = $1', [mine.body.items[0].id]);
      expect(referralRow.qualifying_booking_id).toBe(bookingId);
    });

    it('reverses the wallet credit once the underlying booking is cancelled and genuinely refunded', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/bookings/${bookingId}/cancel`)
        .set('Cookie', referredCookie)
        .expect(201);
      expect(res.body.status).toBe('cancelled_by_user');

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('refunded'); // well outside the 24h window -- full refund

      const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(wallet.body.balances).toContainEqual({ currency: 'toman', balance: 0 });

      const rewards = await request(app.getHttpServer())
        .get('/api/referrals/mine/rewards')
        .set('Cookie', referrerCookie)
        .expect(200);
      expect(rewards.body.items[0]).toMatchObject({ status: 'reversed', rewardKind: 'wallet_credit', rewardValue: 12000 });
    });

    it('is idempotent -- re-running reverseIfNeeded-adjacent flows (a second refund retry pass) does not double-debit', async () => {
      const job = app.get(RefundRetryJob);
      await job.run(); // no-op: payment is already 'refunded', not 'refund_pending'

      const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', referrerCookie).expect(200);
      expect(wallet.body.balances).toContainEqual({ currency: 'toman', balance: 0 });
    });
  });
});
