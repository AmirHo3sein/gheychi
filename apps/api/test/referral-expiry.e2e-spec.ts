import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ReferralExpiryJob } from '../src/booking/referral-expiry.job';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Referral expiry job (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let job: ReferralExpiryJob;
  let adminCookie: string;

  const ADMIN_PHONE = '09141001099';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    job = app.get(ReferralExpiryJob);

    adminCookie = await loginAsAdmin(app, ADMIN_PHONE);

    // A short expirationDays so every referral created below has a real expires_at
    // snapshotted at redemption time -- the job never recomputes it, only sweeps it.
    await request(app.getHttpServer())
      .patch('/api/admin/referral-reward-types/user')
      .set('Cookie', adminCookie)
      .send({ enabled: true, expirationDays: 7 })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createReferral(referrerPhone: string, referredPhone: string): Promise<string> {
    const referrerCookie = await loginAs(app, referrerPhone);
    const codeRes = await request(app.getHttpServer()).get('/api/referrals/my-code').set('Cookie', referrerCookie).expect(200);
    await verifyOtpAndLogin(app, referredPhone, { referralCode: codeRes.body.code });

    const mine = await request(app.getHttpServer()).get('/api/referrals/mine').set('Cookie', referrerCookie).expect(200);
    return mine.body.items[0].id as string;
  }

  it('expires a referral whose expires_at has passed while still awaiting the qualifying event', async () => {
    const referralId = await createReferral('09141001001', '09141001002');
    await ds.query(`UPDATE referrals SET expires_at = now() - interval '1 hour' WHERE id = $1`, [referralId]);

    const expired = await job.run();
    expect(expired).toBe(1);

    const [row] = await ds.query(`SELECT status FROM referrals WHERE id = $1`, [referralId]);
    expect(row.status).toBe('expired');
  });

  it('leaves a referral with no configured expiration untouched', async () => {
    const referralId = await createReferral('09141001003', '09141001004');
    await ds.query(`UPDATE referrals SET expires_at = NULL WHERE id = $1`, [referralId]);

    await job.run();

    const [row] = await ds.query(`SELECT status, expires_at FROM referrals WHERE id = $1`, [referralId]);
    expect(row.status).toBe('awaiting_qualifying_event');
    expect(row.expires_at).toBeNull();
  });

  it('leaves a still-in-window referral untouched', async () => {
    const referralId = await createReferral('09141001005', '09141001006');

    await job.run();

    const [row] = await ds.query(`SELECT status FROM referrals WHERE id = $1`, [referralId]);
    expect(row.status).toBe('awaiting_qualifying_event');
  });

  it('does not touch a referral that already moved past awaiting_qualifying_event', async () => {
    const referralId = await createReferral('09141001007', '09141001008');
    await ds.query(
      `UPDATE referrals SET status = 'cancelled', cancelled_reason = 'test', expires_at = now() - interval '1 hour' WHERE id = $1`,
      [referralId],
    );

    await job.run();

    const [row] = await ds.query(`SELECT status FROM referrals WHERE id = $1`, [referralId]);
    expect(row.status).toBe('cancelled');
  });
});
