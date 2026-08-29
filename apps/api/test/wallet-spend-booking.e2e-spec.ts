import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Wallet spend at checkout (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;

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

  function futureIso(hoursFromNow: number): string {
    return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
  }

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();

    adminCookie = await loginAsAdmin(app, '09131110001');
    ownerCookie = await loginAs(app, '09131110002');
    const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Wallet Spend Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
      categoryIds: [categoriesRes.body[0].id],
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 500_000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
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

  it('partially covers the deposit with wallet balance and charges only the remainder online', async () => {
    const customerCookie = await loginAs(app, '09131110010');
    const userId = await userIdForPhone('09131110010');
    // 20% of 500,000 = 100,000 deposit (above the 200,000 floor? no -- deposit_min_toman
    // is seeded at 200,000, so the floor wins: deposit is 200,000).
    await grantWallet(userId, 50_000);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(24), applyWalletBalance: true })
      .expect(201);

    expect(created.body.booking.walletAmountUsed).toBe(50_000);
    expect(created.body.booking.depositAmount).toBe(150_000); // 200,000 floor - 50,000 wallet
    expect(created.body.paymentRequired).toBe(true);

    const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
    expect(wallet.body.balances.find((b: { currency: string }) => b.currency === 'toman').balance).toBe(0);
  });

  it('confirms the booking outright when wallet balance alone covers the whole deposit', async () => {
    const customerCookie = await loginAs(app, '09131110011');
    const userId = await userIdForPhone('09131110011');
    await grantWallet(userId, 500_000); // comfortably covers the 200,000 floor

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(48), applyWalletBalance: true })
      .expect(201);

    expect(created.body.booking.walletAmountUsed).toBe(200_000);
    expect(created.body.booking.depositAmount).toBe(0);
    expect(created.body.booking.status).toBe('confirmed');
    expect(created.body.paymentRequired).toBe(false);

    const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
    expect(wallet.body.balances.find((b: { currency: string }) => b.currency === 'toman').balance).toBe(300_000);
  });

  it('gives the wallet balance back when a wallet-funded hold expires without payment', async () => {
    const customerCookie = await loginAs(app, '09131110012');
    const userId = await userIdForPhone('09131110012');
    await grantWallet(userId, 50_000);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(72), applyWalletBalance: true })
      .expect(201);
    expect(created.body.booking.walletAmountUsed).toBe(50_000);

    // Nothing was ever captured -- cancelling from pending_payment is the same "no
    // money moved" exit path BookingExpiryJob's own timeout would eventually take.
    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.booking.id}/cancel`)
      .set('Cookie', customerCookie)
      .expect(200);

    const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
    expect(wallet.body.balances.find((b: { currency: string }) => b.currency === 'toman').balance).toBe(50_000);

    const ds = app.get(DataSource);
    const txs = await ds.query(
      `SELECT type, amount FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    expect(txs.map((t: { type: string }) => t.type)).toEqual(['admin_adjustment', 'booking_spend', 'booking_spend_reversal']);
  });

  it('never touches the wallet when applyWalletBalance is not sent, even with a balance available', async () => {
    const customerCookie = await loginAs(app, '09131110013');
    const userId = await userIdForPhone('09131110013');
    await grantWallet(userId, 50_000);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(96) })
      .expect(201);

    expect(created.body.booking.walletAmountUsed).toBeNull();
    expect(created.body.booking.depositAmount).toBe(200_000);

    const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
    expect(wallet.body.balances.find((b: { currency: string }) => b.currency === 'toman').balance).toBe(50_000);
  });

  // releaseBookingHold's wallet credit-back reads bookings.wallet_amount_used, which is
  // never cleared afterward -- a second, concurrent call for the same booking (a
  // back-button + refresh double-delivering a declined Zarinpal callback, exactly the
  // scenario payments.e2e-spec.ts's own "two simultaneous callbacks" test exercises for
  // the SUCCESS path) would credit the wallet back a second time for money that was
  // already returned once. This proves it against the real DB, not a mock.
  it('concurrency: two simultaneous declined callbacks for a wallet-funded hold -- the wallet is credited back exactly once', async () => {
    const customerCookie = await loginAs(app, '09131110014');
    const userId = await userIdForPhone('09131110014');
    await grantWallet(userId, 50_000);

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: futureIso(120), applyWalletBalance: true })
      .expect(201);
    expect(created.body.booking.walletAmountUsed).toBe(50_000);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;

    await Promise.all([
      request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'NOK' }),
      request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'NOK' }),
    ]);

    const wallet = await request(app.getHttpServer()).get('/api/wallet/mine').set('Cookie', customerCookie).expect(200);
    const balance = wallet.body.balances.find((b: { currency: string }) => b.currency === 'toman')?.balance ?? 0;
    // Must be exactly the original grant back -- NOT double-credited.
    expect(balance).toBe(50_000);

    const ds = app.get(DataSource);
    const reversalTxs = await ds.query(
      `SELECT amount FROM wallet_transactions WHERE user_id = $1 AND type = 'booking_spend_reversal'`,
      [userId],
    );
    expect(reversalTxs).toHaveLength(1); // exactly one credit-back, never duplicated
  });
});
