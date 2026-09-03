import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end coverage of the global `feature_online_payment_enabled` toggle
 * (docs/technical-overview/29-global-payment-toggle.md). Deliberately does NOT call
 * enableOnlinePayments() -- every case here relies on the real migration-seeded default
 * (off), unlike nearly every other booking/payment e2e file.
 */
describe('Global online-payment toggle (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;

  const futureIso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

  async function setMode(mode: 'automatic' | 'manual_approval') {
    await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', ownerCookie)
      .send({ bookingConfirmationMode: mode })
      .expect(200);
  }

  async function grantWallet(userId: string, amount: number) {
    await request(app.getHttpServer())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId, amount, reason: 'e2e test grant' })
      .expect(201);
  }

  async function userIdForPhone(phone: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/users?phone=${phone}`)
      .set('Cookie', adminCookie)
      .expect(200);
    return res.body.items[0].id;
  }

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);

    ownerCookie = await loginAs(app, '09181110001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'Payment Toggle Salon' },
      { price: 2_000_000 },
    ));
    customerCookie = await loginAs(app, '09181110002');
    adminCookie = await loginAsAdmin(app, '09181110003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('the public feature-flags endpoint reports online payment off by default', async () => {
    const res = await request(app.getHttpServer()).get('/api/platform-config/feature-flags').expect(200);
    expect(res.body.onlinePaymentEnabled).toBe(false);
  });

  describe('automatic mode', () => {
    beforeAll(() => setMode('automatic'));

    it('confirms outright with no Payment row, even though the deposit is non-zero', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(24) })
        .expect(201);

      expect(res.body.booking.status).toBe('confirmed');
      expect(res.body.paymentRequired).toBe(false);
      // The deposit is still recorded on the row (needed later for CRM/reporting) even
      // though it was never collected online.
      expect(res.body.booking.depositAmount).toBeGreaterThan(0);

      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [res.body.booking.id]);
      expect(payments).toHaveLength(0);
    });

    it('never debits wallet balance toward a deposit that will not be collected online', async () => {
      const userId = await userIdForPhone('09181110002');
      await grantWallet(userId, 500_000);

      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(48), applyWalletBalance: true })
        .expect(201);

      expect(res.body.booking.status).toBe('confirmed');
      const spends = await ds.query(
        `SELECT id FROM wallet_transactions WHERE user_id = $1 AND type = 'booking_spend'`,
        [userId],
      );
      expect(spends).toHaveLength(0);
    });

    it('accrues NO commission when the uncollected booking is later marked completed', async () => {
      // depositAmount is stored on the row but nothing was ever captured -- the ledger
      // (and therefore the salon invoice and /salons/mine/earnings) must not claim the
      // platform holds money it never collected. Regression: recordCommission used to
      // trust booking.depositAmount instead of the paid Payment row.
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(60) })
        .expect(201);
      const bookingId = created.body.booking.id;
      expect(created.body.booking.depositAmount).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingId}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'completed' })
        .expect(200);

      const ledger = await ds.query(`SELECT id FROM financial_transactions WHERE booking_id = $1`, [bookingId]);
      expect(ledger).toHaveLength(0);

      const earnings = await request(app.getHttpServer())
        .get('/api/salons/mine/earnings')
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(earnings.body.totalCollected).toBe(0);
    });
  });

  it('refuses to mint a new gateway session while collection is off, even for an already-pending payment', async () => {
    // Set up a real pending_payment booking WITH the flag on, then turn it off underneath.
    const setFlag = (onlinePaymentEnabled: boolean) =>
      request(app.getHttpServer()).patch('/api/admin/feature-flags').set('Cookie', adminCookie).send({ onlinePaymentEnabled }).expect(200);

    await setFlag(true);
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(200) })
      .expect(201);
    const bookingId = created.body.booking.id;
    expect(created.body.booking.status).toBe('pending_payment');
    // Retry works normally while collection is on.
    await request(app.getHttpServer()).post(`/api/bookings/${bookingId}/retry-payment`).set('Cookie', customerCookie).expect(200);

    await setFlag(false);

    await request(app.getHttpServer())
      .post(`/api/bookings/${bookingId}/retry-payment`)
      .set('Cookie', customerCookie)
      .expect(409);

    // The booking is untouched -- the toggle does not retroactively kill an open window,
    // it only stops new gateway sessions being opened. The expiry cron retires it.
    const [row] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(row.status).toBe('pending_payment');
  });

  describe('manual-approval mode', () => {
    beforeAll(() => setMode('manual_approval'));

    it('still requires the salon to accept the request first (the flag does not bypass approval)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(72) })
        .expect(201);

      expect(res.body.booking.status).toBe('pending_approval');
      expect(res.body.paymentRequired).toBe(false);
    });

    it('approve() confirms directly with no payment window and no Payment row', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(96) })
        .expect(201);
      const bookingId = created.body.booking.id;

      const approved = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);

      expect(approved.body.status).toBe('confirmed');
      expect(approved.body.paymentExpiresAt).toBeNull();

      const payments = await ds.query(`SELECT id FROM payments WHERE booking_id = $1`, [bookingId]);
      expect(payments).toHaveLength(0);
    });

    it('hands back wallet balance staked while the flag was ON when the flag is OFF by approval time', async () => {
      const setFlag = (onlinePaymentEnabled: boolean) =>
        request(app.getHttpServer()).patch('/api/admin/feature-flags').set('Cookie', adminCookie).send({ onlinePaymentEnabled }).expect(200);

      const userId = await userIdForPhone('09181110002');
      const balanceOf = async () => {
        const res = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
        return Number(res.body.balances.find((b: { currency: string }) => b.currency === 'toman')?.balance ?? 0);
      };
      // The earlier automatic-mode test already granted 500,000 and (correctly) spent none.
      const before = await balanceOf();
      expect(before).toBeGreaterThan(0);

      await setFlag(true);
      const created = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId, startsAt: futureIso(120), applyWalletBalance: true })
        .expect(201);
      const bookingId = created.body.booking.id;
      expect(created.body.booking.status).toBe('pending_approval');
      const [{ wallet_amount_used }] = await ds.query(`SELECT wallet_amount_used FROM bookings WHERE id = $1`, [bookingId]);
      expect(Number(wallet_amount_used)).toBeGreaterThan(0);
      expect(await balanceOf()).toBe(before - Number(wallet_amount_used));

      // Admin turns collection off while the request sits in pending_approval.
      await setFlag(false);
      const approved = await request(app.getHttpServer())
        .post(`/api/salons/mine/bookings/${bookingId}/approve`)
        .set('Cookie', ownerCookie)
        .expect(200);
      expect(approved.body.status).toBe('confirmed');

      // Nothing will ever be captured against this booking, so the debit is reversed --
      // the customer pays the full price in cash and keeps their credit (regression: this
      // used to silently vanish the staked balance).
      expect(await balanceOf()).toBe(before);
      const [{ wallet_amount_used: after }] = await ds.query(`SELECT wallet_amount_used FROM bookings WHERE id = $1`, [bookingId]);
      expect(Number(after)).toBe(0);
      const reversals = await ds.query(
        `SELECT id FROM wallet_transactions WHERE user_id = $1 AND type = 'booking_spend_reversal'`,
        [userId],
      );
      expect(reversals).toHaveLength(1);
    });
  });
});
