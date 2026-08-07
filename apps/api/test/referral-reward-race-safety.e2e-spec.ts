import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { REDIS } from '../src/redis/redis.module';
import { ReferralsService } from '../src/referrals/referrals.service';
import { WalletService } from '../src/wallet/wallet.service';
import { clearOtpIpRateLimit, loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Race-safety and reversal-shortfall coverage for slice 4 (reward granting) that the
// happy-path/partial-grant/single-reversal scenarios in referral-reward-granting.e2e-spec.ts
// don't exercise: tryGrantReward driven twice concurrently for the identical trigger,
// two different referrals crediting the same referrer concurrently (proves the
// up-front wallet_balances lock actually serializes them, not just the single-row
// lock inside WalletService.credit), reverseIfNeeded double-called back-to-back, a
// reversal that must clamp at an already-partially-spent balance and page
// AlertsService, and reward_max actually capping the credited amount.
describe('Referral reward granting -- race-safety and reversal-shortfall (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let referrals: ReferralsService;
  let wallet: WalletService;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  const ADMIN_PHONE = '09151000099';
  const OWNER_PHONE = '09151000001';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    referrals = app.get(ReferralsService);
    wallet = app.get(WalletService);

    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);
    ownerCookie = await loginAs(app, OWNER_PHONE);

    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const categoryId = categoriesRes.body[0].id;
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Audit Salon',
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

  async function getMyCode(cookie: string): Promise<string> {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cookie).expect(200);
    return res.body.code;
  }

  async function setUserType(patch: Record<string, unknown>) {
    await request(app.getHttpServer())
      .patch('/api/admin/referral-reward-types/user')
      .set('Cookie', adminCookie)
      .send(patch)
      .expect(200);
  }

  // -----------------------------------------------------------------------
  // (a) Double-drive tryGrantReward for the EXACT same booking/event
  // -----------------------------------------------------------------------
  describe('(a) tryGrantReward driven twice for the same booking/event', () => {
    const REFERRER = '09151000010';
    const REFERRED = '09151000011';
    let referrerCookie: string, referredCookie: string, bookingId: string, referredUserId: string;

    it('sets up + grants once via the real completion flow', async () => {
      referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 7000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 4000,
        qualifyingEvent: 'first_completed_booking',
      });
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const [urow] = await ds.query(`SELECT id FROM users WHERE phone = $1`, [REFERRED]);
      referredUserId = urow.id;

      const created = await bookAndConfirm(referredCookie);
      bookingId = created.bookingId;
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);
    });

    it('CONCURRENTLY re-drives tryGrantReward twice more for the identical (referredUserId, bookingId, "completed") triple', async () => {
      // First call already fully granted this referral inline above. Now hit the
      // exact same method with the exact same args, twice, at once -- simulating a
      // retried webhook / job racing the inline call.
      await Promise.all([
        referrals.tryGrantReward(referredUserId, bookingId, 'completed'),
        referrals.tryGrantReward(referredUserId, bookingId, 'completed'),
      ]);

      const rewardRows = await ds.query(
        `SELECT rr.beneficiary_role, rr.status FROM referral_rewards rr
         JOIN referrals r ON r.id = rr.referral_id WHERE r.referred_user_id = $1`,
        [referredUserId],
      );
      const walletTxRows = await ds.query(
        `SELECT amount FROM wallet_transactions wt
         JOIN users u ON u.id = wt.user_id WHERE u.phone IN ($1, $2)`,
        [REFERRER, REFERRED],
      );
      const [referrerBal] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1 AND wb.currency = 'toman'`,
        [REFERRER],
      );
      const [referredBal] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1 AND wb.currency = 'toman'`,
        [REFERRED],
      );

      expect(rewardRows).toHaveLength(2); // exactly one per side, never duplicated
      expect(walletTxRows).toHaveLength(2); // exactly one credit per side, never duplicated
      expect(Number(referrerBal.balance)).toBe(7000); // moved exactly once
      expect(Number(referredBal.balance)).toBe(4000); // moved exactly once
    });
  });

  // -----------------------------------------------------------------------
  // (b) first_paid_booking genuinely cannot grant before grant_holdback_hours
  // -----------------------------------------------------------------------
  describe('(b) grant hold-back window is actually enforced against paid_at', () => {
    const REFERRER = '09151000020';
    const REFERRED = '09151000021';
    let referrerCookie: string, referredCookie: string, bookingId: string, referredUserId: string;

    it('sets a 5-hour hold-back, redeems, pays -- grant must NOT fire immediately', async () => {
      referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 9000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 6000,
        qualifyingEvent: 'first_paid_booking',
        grantHoldbackHours: 5,
      });
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED, { referralCode: code });
      referredCookie = cookie;
      expect(body.referralStatus).toBe('applied');

      const [urow] = await ds.query(`SELECT id FROM users WHERE phone = $1`, [REFERRED]);
      referredUserId = urow.id;

      const created = await bookAndConfirm(referredCookie);
      bookingId = created.bookingId;

      // paid_at was just set to "now" by the payment callback -- well under 5h old.
      await referrals.tryGrantReward(referredUserId, bookingId, 'paid');

      const [referralRow] = await ds.query(`SELECT status FROM referrals WHERE referred_user_id = $1`, [referredUserId]);
      expect(referralRow.status).toBe('awaiting_qualifying_event'); // must NOT have granted

      const balRows = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1`,
        [REFERRER],
      );
      expect(balRows).toHaveLength(0); // no wallet row was even created -- nothing granted
    });

    it('backdating paid_at past the hold-back and re-driving grants it for real', async () => {
      await ds.query(`UPDATE payments SET paid_at = now() - interval '6 hours' WHERE booking_id = $1`, [bookingId]);
      await referrals.tryGrantReward(referredUserId, bookingId, 'paid');

      const [referralRow] = await ds.query(`SELECT status FROM referrals WHERE referred_user_id = $1`, [referredUserId]);
      expect(referralRow.status).toBe('reward_granted');

      const [referrerBal] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1`,
        [REFERRER],
      );
      expect(Number(referrerBal.balance)).toBe(9000);
    });
  });

  // -----------------------------------------------------------------------
  // (c) TWO DIFFERENT referrals crediting the SAME referrer, concurrently
  // -----------------------------------------------------------------------
  describe('(c) same-referrer concurrent grant from two different referrals', () => {
    const REFERRER = '09151000030';
    const REFERRED_A = '09151000031';
    const REFERRED_B = '09151000032';
    let referrerCookie: string;
    let referredAId: string, referredBId: string, bookingAId: string, bookingBId: string;

    it('sets up two independent referrals from the same referrer, both awaiting first_completed_booking', async () => {
      referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 5000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 1000,
        qualifyingEvent: 'first_completed_booking',
      });

      const a = await verifyOtpAndLogin(app, REFERRED_A, { referralCode: code });
      expect(a.body.referralStatus).toBe('applied');
      const b = await verifyOtpAndLogin(app, REFERRED_B, { referralCode: code });
      expect(b.body.referralStatus).toBe('applied');

      const [ua] = await ds.query(`SELECT id FROM users WHERE phone = $1`, [REFERRED_A]);
      const [ub] = await ds.query(`SELECT id FROM users WHERE phone = $1`, [REFERRED_B]);
      referredAId = ua.id;
      referredBId = ub.id;

      bookingAId = (await bookAndConfirm(a.cookie)).bookingId;
      bookingBId = (await bookAndConfirm(b.cookie)).bookingId;
    });

    it('grants both concurrently -- referrer balance must equal the exact sum, no lost update', async () => {
      await Promise.all([
        referrals.tryGrantReward(referredAId, bookingAId, 'completed'),
        referrals.tryGrantReward(referredBId, bookingBId, 'completed'),
      ]);

      const [referrerBal] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1 AND wb.currency = 'toman'`,
        [REFERRER],
      );
      expect(Number(referrerBal.balance)).toBe(10000); // 5000 + 5000, NOT 5000 (lost update)

      const txRows = await ds.query(
        `SELECT wt.amount, wt.balance_after FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
         WHERE u.phone = $1 ORDER BY wt.created_at ASC`,
        [REFERRER],
      );
      expect(txRows).toHaveLength(2);
      // The two transactions must form a consistent chain (serialized), not both
      // computed off the same stale balance=0 read.
      const afters = txRows.map((r: { balance_after: string }) => Number(r.balance_after)).sort((x: number, y: number) => x - y);
      expect(afters).toEqual([5000, 10000]);
    });
  });

  // -----------------------------------------------------------------------
  // (d) reverseIfNeeded forced double-call -- must never double-debit
  // -----------------------------------------------------------------------
  describe('(d) reverseIfNeeded is idempotent under a forced double-call', () => {
    const REFERRER = '09151000040';
    const REFERRED = '09151000041';
    let referrerCookie: string, bookingId: string;

    it('grants a wallet_credit reward, then reverses it twice back-to-back', async () => {
      referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 6000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 2000,
        qualifyingEvent: 'first_completed_booking',
      });
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED, { referralCode: code });
      expect(body.referralStatus).toBe('applied');

      const created = await bookAndConfirm(cookie);
      bookingId = created.bookingId;
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);

      const [referrerBalBefore] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1`,
        [REFERRER],
      );
      expect(Number(referrerBalBefore.balance)).toBe(6000);

      // Force TWO reversal passes back-to-back (simulating a defensive re-check /
      // retry racing the real one), NOT via the real refund flow (payment status
      // here is still 'paid', not 'refunded' -- reverseIfNeeded doesn't care, it
      // only keys off referrals.qualifying_booking_id + referral_rewards.status).
      await referrals.reverseIfNeeded(bookingId);
      await referrals.reverseIfNeeded(bookingId);

      const [referrerBalAfter] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1`,
        [REFERRER],
      );
      expect(Number(referrerBalAfter.balance)).toBe(0); // NOT negative, debited exactly once

      const debitRows = await ds.query(
        `SELECT amount FROM wallet_transactions wt JOIN users u ON u.id = wt.user_id
         WHERE u.phone = $1 AND wt.type = 'referral_reversal'`,
        [REFERRER],
      );
      expect(debitRows).toHaveLength(1); // exactly one reversal transaction, not two
    });
  });

  // -----------------------------------------------------------------------
  // (e) reversal shortfall capped at available balance + recorded + alerted
  // -----------------------------------------------------------------------
  describe('(e) reversal shortfall: never negative, recorded, and alerts critical', () => {
    const REFERRER = '09151000050';
    const REFERRED = '09151000051';
    let bookingId: string, referrerUserId: string, rewardId: string;

    it('grants a wallet_credit reward, drains most of the balance, then forces a reversal', async () => {
      const referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 10000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 1000,
        qualifyingEvent: 'first_completed_booking',
      });
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED, { referralCode: code });
      expect(body.referralStatus).toBe('applied');

      const created = await bookAndConfirm(cookie);
      bookingId = created.bookingId;
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);

      const [urow] = await ds.query(`SELECT id FROM users WHERE phone = $1`, [REFERRER]);
      referrerUserId = urow.id;
      const [rewardRow] = await ds.query(
        `SELECT rr.id FROM referral_rewards rr JOIN referrals r ON r.id = rr.referral_id
         WHERE r.referrer_user_id = $1 AND rr.beneficiary_role = 'referrer'`,
        [referrerUserId],
      );
      rewardId = rewardRow.id;

      // Simulate the referrer having already spent/withdrawn most of the credit --
      // there's no user-facing spend feature yet, so drive it via the same primitive
      // a real future spend feature (or an admin debit) would use, straight through
      // WalletService.debit inside its own transaction (mirrors how any real caller
      // uses it).
      await ds.transaction(async (em) => {
        await wallet.debit(em, referrerUserId, 'toman', 9200, 'admin_adjustment', { reason: 'test: simulate spend' });
      });
      const [balBeforeReversal] = await ds.query(`SELECT balance FROM wallet_balances WHERE user_id = $1 AND currency='toman'`, [
        referrerUserId,
      ]);
      expect(Number(balBeforeReversal.balance)).toBe(800); // 10000 - 9200

      await referrals.reverseIfNeeded(bookingId);

      const [balAfter] = await ds.query(`SELECT balance FROM wallet_balances WHERE user_id = $1 AND currency='toman'`, [
        referrerUserId,
      ]);
      expect(Number(balAfter.balance)).toBe(0); // capped, never negative

      const [rewardRow2] = await ds.query(
        `SELECT status, reversal_shortfall_amount FROM referral_rewards WHERE id = $1`,
        [rewardId],
      );
      expect(rewardRow2.status).toBe('reversed');
      expect(Number(rewardRow2.reversal_shortfall_amount)).toBe(9200); // debit capped at 800 available, so shortfall = 10000 - 800 = 9200

      const [notif] = await ds.query(
        `SELECT type, title, body FROM admin_notifications WHERE body LIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${rewardId}%`],
      );
      expect(notif).toBeDefined(); // AlertsService.raise() actually persisted a critical alert
      expect(notif.type).toBe('alert');
      expect(notif.title).toContain('کسری');
    });
  });

  // -----------------------------------------------------------------------
  // (f) reward_max cap is actually applied before crediting
  // -----------------------------------------------------------------------
  describe('(f) referrer_reward_max caps the actual credited amount', () => {
    const REFERRER = '09151000060';
    const REFERRED = '09151000061';

    it('sets value=50000, max=12000 -- only 12000 must ever be credited', async () => {
      const referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 50000,
        referrerRewardMax: 12000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 1000,
        qualifyingEvent: 'first_completed_booking',
      });
      const { cookie, body } = await verifyOtpAndLogin(app, REFERRED, { referralCode: code });
      expect(body.referralStatus).toBe('applied');

      const created = await bookAndConfirm(cookie);
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${created.bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);

      const [referrerBal] = await ds.query(
        `SELECT balance FROM wallet_balances wb JOIN users u ON u.id = wb.user_id WHERE u.phone = $1`,
        [REFERRER],
      );
      expect(Number(referrerBal.balance)).toBe(12000); // capped, not 50000

      const [rewardRow] = await ds.query(
        `SELECT reward_value FROM referral_rewards rr JOIN referrals r ON r.id = rr.referral_id
         JOIN users u ON u.id = r.referrer_user_id WHERE u.phone = $1 AND rr.beneficiary_role = 'referrer'`,
        [REFERRER],
      );
      expect(Number(rewardRow.reward_value)).toBe(12000); // stored value also capped
    });
  });

  // -----------------------------------------------------------------------
  // (g) R10 -- max_referrals_per_referrer must actually be enforced under
  // concurrent registration, not just when driven one at a time (referrals.e2e-spec.ts
  // already covers the sequential case). Found by adversarial review to be a genuine
  // count-then-insert race with zero locking -- 8 concurrent registrations against a
  // cap of 2 all landed as 'applied' before the fix (applyReferralAtRegistration now
  // takes SELECT ... FOR UPDATE on the referral_codes row before counting).
  // -----------------------------------------------------------------------
  describe('(g) R10 max_referrals_per_referrer cap is race-safe under concurrent redemption', () => {
    const REFERRER = '09151000070';

    it('8 concurrent registrations against a cap of 2 -- exactly 2 succeed, not 8', async () => {
      const redis = app.get<Redis>(REDIS);
      const referrerCookie = await loginAs(app, REFERRER);
      const code = await getMyCode(referrerCookie);
      await setUserType({
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 1000,
        referredRewardKind: 'wallet_credit',
        referredRewardValue: 500,
        qualifyingEvent: 'first_completed_booking',
        maxReferralsPerReferrer: 2,
      });

      const phones = Array.from({ length: 8 }, (_, i) => `091510009${i}0`);
      const otps: string[] = [];
      // A single clear before the burst, not per-iteration: this loop makes 8 real
      // request-otp calls for 8 distinct phones in quick succession, well within the
      // per-phone limit each but easily enough to trip the per-IP limit (otp.service.ts)
      // on top of whatever the shared test-suite IP counter already sat at.
      await clearOtpIpRateLimit(redis);
      for (const phone of phones) {
        await redis.del(`otp:rl:${phone}`);
        await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
        otps.push((await redis.get(`otp:${phone}`))!);
      }

      const results = await Promise.all(
        phones.map((phone, i) =>
          request(app.getHttpServer()).post('/api/auth/verify-otp').send({ phone, code: otps[i], referralCode: code }),
        ),
      );
      const appliedCount = results.filter((r) => r.body.referralStatus === 'applied').length;
      expect(appliedCount).toBe(2); // exactly cap-many, never cap+1

      const [{ count }] = await ds.query(
        `SELECT COUNT(*)::int AS count FROM referrals r JOIN referral_codes rc ON rc.id = r.referral_code_id
         WHERE rc.code = $1 AND r.status != 'cancelled'`,
        [code],
      );
      expect(Number(count)).toBe(2); // the DB rows agree with the API responses
    });
  });
});
