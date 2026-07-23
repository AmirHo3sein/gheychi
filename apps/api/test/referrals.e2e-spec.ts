import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Referral codes + tracking (e2e)', () => {
  let app: INestApplication;
  let referrerCookie: string;
  let adminCookie: string;
  let referralCode: string;

  const REFERRER_PHONE = '09131000001';
  const REFERRED_PHONE_1 = '09131000002'; // redeemed while the 'user' type is still disabled
  const REFERRED_PHONE_2 = '09131000003'; // redeemed after enabling
  const REFERRED_PHONE_3 = '09131000004'; // second redemption of the SAME code -- codes are reusable
  const ADMIN_PHONE = '09131000099';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    referrerCookie = await loginAs(app, REFERRER_PHONE);
    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lazily mints a lifetime referral code on first request', async () => {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', referrerCookie).expect(200);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.body.isActive).toBe(true);
    expect(res.body.shareUrl).toContain(res.body.code);
    referralCode = res.body.code;
  });

  it('returns the exact same code on a second call (never reissued)', async () => {
    const res = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', referrerCookie).expect(200);
    expect(res.body.code).toBe(referralCode);
  });

  it('rejects an unauthenticated caller for my-code', () =>
    request(app.getHttpServer()).get('/api/referrals/my-code').expect(401));

  it('validate is public and confirms an active code without leaking anything else', async () => {
    const res = await request(app.getHttpServer()).get('/api/referrals/validate').query({ code: referralCode }).expect(200);
    expect(res.body).toEqual({ valid: true });
  });

  it('validate reports an unknown code as invalid', async () => {
    const res = await request(app.getHttpServer()).get('/api/referrals/validate').query({ code: 'NOPE0000' }).expect(200);
    expect(res.body).toEqual({ valid: false });
  });

  describe('default-disabled path (all three referral types ship enabled=false)', () => {
    it('a fresh registration with a valid code gets referral_type_disabled and creates no referrals row', async () => {
      const { body } = await verifyOtpAndLogin(app, REFERRED_PHONE_1, { referralCode });
      expect(body.isNewUser).toBe(true);
      expect(body.referralStatus).toBe('referral_type_disabled');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(mine.body.total).toBe(0);
    });
  });

  describe('after an admin enables the user referral type', () => {
    it('admin lists the 3 fixed reward-type rows, all disabled by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/referral-reward-types')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.every((r: { enabled: boolean }) => r.enabled === false)).toBe(true);
    });

    it('a non-admin cannot enable a referral type', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', referrerCookie)
        .send({ enabled: true })
        .expect(403);
    });

    it('enables the user referral type', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({ enabled: true, referrerRewardValue: 20000, referredRewardValue: 15 })
        .expect(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.referrerRewardValue).toBe(20000);
    });

    it('a brand-new registration with the code now gets applied', async () => {
      const { body } = await verifyOtpAndLogin(app, REFERRED_PHONE_2, { referralCode });
      expect(body.isNewUser).toBe(true);
      expect(body.referralStatus).toBe('applied');
    });

    it("shows exactly one row awaiting_qualifying_event on the referrer's own list", async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ status: 'awaiting_qualifying_event', referralType: 'user' });
      expect(res.body.items[0].rewardGrantedAt).toBeNull();
    });

    it("masks the referred user's phone -- the referrer never sees the exact number", async () => {
      const res = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      const masked = res.body.items[0].referredUserPhoneMasked;
      expect(masked).toBe('0913***0003');
      expect(masked).not.toBe(REFERRED_PHONE_2);
    });

    it('the same code works again for a second, distinct brand-new registration (codes are reusable)', async () => {
      const { body } = await verifyOtpAndLogin(app, REFERRED_PHONE_3, { referralCode });
      expect(body.referralStatus).toBe('applied');

      const res = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(2);
    });

    it('an already-existing account never has referralCode read at all -- no new row, no referralStatus', async () => {
      const { body } = await verifyOtpAndLogin(app, REFERRED_PHONE_2, { referralCode });
      expect(body.isNewUser).toBe(false);
      expect(body.referralStatus).toBeUndefined();

      const res = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
      expect(res.body.total).toBe(2);
    });
  });

  describe('admin oversight + cancel', () => {
    let cancellableId: string;

    it('lists referrals filterable by referrer phone, with the referrer phone unmasked but the referred phone masked', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/referrals')
        .query({ referrerPhone: REFERRER_PHONE })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items[0].referrerPhone).toBe(REFERRER_PHONE);
      expect(res.body.items[0].referredUserPhoneMasked).toMatch(/^\d{4}\*+\d{4}$/);
      cancellableId = res.body.items[0].id;
    });

    it('a non-admin cannot list or cancel referrals', async () => {
      await request(app.getHttpServer()).get('/api/admin/referrals').set('Cookie', referrerCookie).expect(403);
      await request(app.getHttpServer())
        .patch(`/api/admin/referrals/${cancellableId}/cancel`)
        .set('Cookie', referrerCookie)
        .send({ reason: 'nope' })
        .expect(403);
    });

    it('cancels a referral still awaiting its qualifying event', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/referrals/${cancellableId}/cancel`)
        .set('Cookie', adminCookie)
        .send({ reason: 'fraud suspected' })
        .expect(200);
      expect(res.body.status).toBe('cancelled');
      expect(res.body.cancelledReason).toBe('fraud suspected');
    });

    it('a second cancel attempt on the same row gets 409', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/referrals/${cancellableId}/cancel`)
        .set('Cookie', adminCookie)
        .send({ reason: 'already cancelled' })
        .expect(409);
    });

    it('404s cancelling a referral that does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/referrals/00000000-0000-0000-0000-000000000000/cancel')
        .set('Cookie', adminCookie)
        .send({ reason: 'nope' })
        .expect(404);
    });
  });

  describe("worker's own lifetime code, relayed by the salon owner", () => {
    it('the owner can fetch a worker referral code out of band', async () => {
      const ownerCookie = await loginAs(app, '09131000010');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
        name: 'Referral Test Salon',
        genderTarget: 'women',
        address: 'Somewhere St, No. 1',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        capacity: 5,
      });

      const workerRes = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .send({ name: 'Sara Stylist', phone: '09131000011' })
        .expect(201);

      const codeRes = await request(app.getHttpServer())
        .get(`/api/salons/mine/workers/${workerRes.body.id}/referral-code`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(codeRes.body.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(codeRes.body.isActive).toBe(true);
    });

    it("404s fetching another owner's worker referral code", async () => {
      const strangerCookie = await loginAs(app, '09131000012');
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', strangerCookie).send({
        name: 'Stranger Salon',
        genderTarget: 'women',
        address: 'Elsewhere St, No. 2',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        capacity: 5,
      });

      const ownerCookie = await loginAs(app, '09131000010'); // already created above
      const workersRes = await request(app.getHttpServer())
        .get('/api/salons/mine/workers')
        .set('Cookie', ownerCookie)
        .expect(200);
      const workerId = workersRes.body[0].id;

      await request(app.getHttpServer())
        .get(`/api/salons/mine/workers/${workerId}/referral-code`)
        .set('Cookie', strangerCookie)
        .expect(404);
    });
  });

  describe('R10 -- max_referrals_per_referrer enforced at redemption time (Slice 5, Piece 2)', () => {
    const CAPPED_REFERRER_PHONE = '09131000020';
    const REFERRED_A = '09131000021';
    const REFERRED_B = '09131000022';
    const REFERRED_C = '09131000023'; // past the cap
    const REFERRED_D = '09131000024'; // redeems after a cancellation frees up a slot
    let cappedReferrerCookie: string;
    let capReferralAId: string;

    it('admin caps the (already-enabled from earlier in this file) user type at 2 referrals per referrer', async () => {
      cappedReferrerCookie = await loginAs(app, CAPPED_REFERRER_PHONE);
      await request(app.getHttpServer())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({ maxReferralsPerReferrer: 2 })
        .expect(200);
    });

    it('the first redemption succeeds (count 0 < 2)', async () => {
      const code = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cappedReferrerCookie).expect(200);
      const { body } = await verifyOtpAndLogin(app, REFERRED_A, { referralCode: code.body.code });
      expect(body.referralStatus).toBe('applied');
    });

    it('the second redemption succeeds (count 1 < 2, right up to the cap)', async () => {
      const code = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cappedReferrerCookie).expect(200);
      const { body } = await verifyOtpAndLogin(app, REFERRED_B, { referralCode: code.body.code });
      expect(body.referralStatus).toBe('applied');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', cappedReferrerCookie).expect(200);
      expect(mine.body.total).toBe(2);
    });

    it('the third redemption is blocked (count 2 >= 2) -- referral_type_disabled, creates no row', async () => {
      const code = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cappedReferrerCookie).expect(200);
      const { body } = await verifyOtpAndLogin(app, REFERRED_C, { referralCode: code.body.code });
      expect(body.referralStatus).toBe('referral_type_disabled');

      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', cappedReferrerCookie).expect(200);
      expect(mine.body.total).toBe(2); // still 2 -- no row was created for REFERRED_C
    });

    it('cancelling one of the two existing referrals frees up a slot -- a cancelled referral does not count against the cap', async () => {
      const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', cappedReferrerCookie).expect(200);
      capReferralAId = mine.body.items[0].id;

      await request(app.getHttpServer())
        .patch(`/api/admin/referrals/${capReferralAId}/cancel`)
        .set('Cookie', adminCookie)
        .send({ reason: 'freeing a slot for the R10 e2e test' })
        .expect(200);

      const code = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', cappedReferrerCookie).expect(200);
      const { body } = await verifyOtpAndLogin(app, REFERRED_D, { referralCode: code.body.code });
      expect(body.referralStatus).toBe('applied'); // non-cancelled count is now 1 (< 2), so this succeeds

      const mineAfter = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', cappedReferrerCookie).expect(200);
      expect(mineAfter.body.total).toBe(3); // 2 original + the new one (REFERRED_C's attempt created nothing)
      expect(mineAfter.body.items.filter((r: { status: string }) => r.status === 'cancelled')).toHaveLength(1);
    });
  });

  describe('Admin projection + rewards endpoint (Slice 5, Piece 3)', () => {
    let projectionReferralId: string;

    it('GET /admin/referrals now projects referrer/referred rewardKind/Value/Max onto each row', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/referrals')
        .query({ referrerPhone: '09131000020' })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      const row = res.body.items[0];
      projectionReferralId = row.id;
      expect(row).toMatchObject({
        referrerRewardKind: 'wallet_credit',
        referredRewardKind: 'percent_discount',
      });
      expect(typeof row.referrerRewardValue).toBe('number');
      expect(typeof row.referredRewardValue).toBe('number');
    });

    it('GET /admin/referrals/:id/rewards returns an empty array for a referral still awaiting its qualifying event', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/referrals/${projectionReferralId}/rewards`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('GET /admin/referrals/:id/rewards 404s for a referral that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/referrals/00000000-0000-0000-0000-000000000000/rewards')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('a non-admin gets 403 from both the list and the rewards-detail endpoints', async () => {
      await request(app.getHttpServer()).get('/api/admin/referrals').set('Cookie', referrerCookie).expect(403);
      await request(app.getHttpServer())
        .get(`/api/admin/referrals/${projectionReferralId}/rewards`)
        .set('Cookie', referrerCookie)
        .expect(403);
    });
  });
});
