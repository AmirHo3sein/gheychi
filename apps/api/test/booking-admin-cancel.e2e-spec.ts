import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PushService } from '../src/push/push.service';
import { REDIS } from '../src/redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../src/sms/sms.provider';
import { createApprovedSalonWithService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { startBookingInThePast } from './utils/booking-time';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * Money-moving booking rules, with online payment ON: platform cancellation
 * (POST /admin/bookings/:id/cancel -> cancelled_by_admin), the wallet/coupon returned on
 * every refunded cancellation, the cancellation-window snapshot, and the prepaid/amount-due
 * fields on salon responses.
 */
describe('Booking money rules: admin cancel, wallet return, window snapshot (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  let adminCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let serviceId: string;

  const http = () => app.getHttpServer();
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  async function userIdFor(phone: string): Promise<string> {
    const res = await request(http()).get(`/api/admin/users?phone=${phone}`).set('Cookie', adminCookie).expect(200);
    return res.body.items[0].id;
  }

  async function grantWallet(phone: string, amount: number): Promise<void> {
    await request(http())
      .post('/api/admin/wallet/adjust')
      .set('Cookie', adminCookie)
      .send({ userId: await userIdFor(phone), amount, reason: 'e2e grant' })
      .expect(201);
  }

  async function walletBalance(cookie: string): Promise<number> {
    const res = await request(http()).get('/api/wallet/mine').set('Cookie', cookie).expect(200);
    return res.body.balances.find((b: { currency: string }) => b.currency === 'toman')?.balance ?? 0;
  }

  async function setConfig(key: string, value: number): Promise<void> {
    await ds.query(`UPDATE platform_config SET value = to_jsonb($2::int) WHERE key = $1`, [key, value]);
    await redis.del(`platform-config:${key}`);
  }

  /** Creates a hold; when `pay` is set, completes the (mock) gateway callback so it is confirmed. */
  async function book(
    cookie: string,
    startsAt: string,
    opts: { pay?: boolean; applyWalletBalance?: boolean; couponCode?: string; salon?: { salonId: string; serviceId: string } } = {},
  ) {
    const target = { salonId: (opts.salon ?? { salonId }).salonId, serviceId: (opts.salon ?? { serviceId }).serviceId };
    const created = await request(http())
      .post('/api/bookings')
      .set('Cookie', cookie)
      .send({
        ...target,
        startsAt,
        ...(opts.applyWalletBalance ? { applyWalletBalance: true } : {}),
        ...(opts.couponCode ? { couponCode: opts.couponCode } : {}),
      })
      .expect(201);
    if (opts.pay !== false && created.body.paymentRequired) {
      const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
      await request(http()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    }
    return created.body.booking.id as string;
  }

  const adminCancel = (bookingId: string, reason = 'salon suspended by admin') =>
    request(http()).post(`/api/admin/bookings/${bookingId}/cancel`).set('Cookie', adminCookie).send({ reason });

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);
    redis = app.get<Redis>(REDIS);
    adminCookie = await loginAsAdmin(app, '09160000099');
    ownerCookie = await loginAs(app, '09160000001');
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { capacity: 1 }));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /admin/bookings/:id/cancel', () => {
    it('cancels a paid confirmed booking: refunds the capture in full, frees the slot, logs the event and the audit row, notifies the customer', async () => {
      const sms = app.get<SmsProvider>(SMS_PROVIDER);
      const push = app.get(PushService);
      const smsSpy = jest.spyOn(sms, 'send');
      const pushSpy = jest.spyOn(push, 'sendToUser');
      const customer = await loginAs(app, '09160000010');
      const bookingId = await book(customer, hours(2)); // inside the customer's own window: a customer cancel would FORFEIT
      smsSpy.mockClear();
      pushSpy.mockClear();

      const res = await adminCancel(bookingId, 'salon suspended by admin').expect(200);
      expect(res.body.status).toBe('cancelled_by_admin');

      const [payment] = await ds.query('SELECT status, refund_ref_id FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('refunded');
      expect(payment.refund_ref_id).toMatch(/^MOCKREFUND-/);

      const detail = await request(http()).get(`/api/bookings/${bookingId}`).set('Cookie', customer).expect(200);
      expect(detail.body).toMatchObject({ status: 'cancelled_by_admin', refundStatus: 'done', depositPaid: true });

      // The slot (capacity 1) is free again.
      const other = await loginAs(app, '09160000011');
      const rebook = await request(http())
        .post('/api/bookings')
        .set('Cookie', other)
        .send({ salonId, serviceId, startsAt: new Date(new Date(detail.body.startsAt).getTime()).toISOString() })
        .expect(201);
      await adminCancel(rebook.body.booking.id).expect(200); // keep later tests' slots free

      const events = await request(http()).get(`/api/admin/bookings/${bookingId}/events`).set('Cookie', adminCookie).expect(200);
      const cancelled = events.body.find((e: { eventType: string }) => e.eventType === 'BOOKING_CANCELLED');
      expect(cancelled).toMatchObject({ actorType: 'admin', metadata: expect.objectContaining({ reason: 'salon suspended by admin', fromStatus: 'confirmed' }) });
      expect(events.body.map((e: { eventType: string }) => e.eventType)).toContain('SLOT_RELEASED');

      const audit = await ds.query(`SELECT actor_id, target_id, success, payload FROM audit_log WHERE action = 'booking.cancelled_by_admin' AND target_id = $1`, [bookingId]);
      expect(audit).toHaveLength(1);
      expect(audit[0].success).toBe(true);
      expect(audit[0].payload).toMatchObject({ reason: 'salon suspended by admin' });

      // Confirmed => push AND SMS to the customer.
      expect(smsSpy.mock.calls.some(([phone, body]) => phone === '09160000010' && String(body).includes('توسط پشتیبانی'))).toBe(true);
      expect(pushSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: 'لغو نوبت توسط پشتیبانی' }));
      smsSpy.mockRestore();
      pushSpy.mockRestore();
    });

    it('cancels an unpaid pending_payment hold without a refund and without texting the customer', async () => {
      const sms = app.get<SmsProvider>(SMS_PROVIDER);
      const smsSpy = jest.spyOn(sms, 'send');
      const customer = await loginAs(app, '09160000012');
      const bookingId = await book(customer, hours(72), { pay: false });
      smsSpy.mockClear();

      await adminCancel(bookingId).expect(200);

      const [row] = await ds.query(
        `SELECT b.status, p.status AS payment_status FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id WHERE b.id = $1`,
        [bookingId],
      );
      expect(row).toEqual({ status: 'cancelled_by_admin', payment_status: 'failed' });
      expect(smsSpy.mock.calls.some(([phone]) => phone === '09160000012')).toBe(false);
      smsSpy.mockRestore();
    });

    it('returns the wallet credit and the coupon code, and the customer can use the code again', async () => {
      await request(http()).post('/api/salons/mine/coupons').set('Cookie', ownerCookie).send({ code: 'ADM10', discountPercent: 10 }).expect(201);
      const customer = await loginAs(app, '09160000013');
      await grantWallet('09160000013', 50_000);

      const bookingId = await book(customer, hours(96), { applyWalletBalance: true, couponCode: 'ADM10' });
      expect(await walletBalance(customer)).toBe(0);
      const [{ count: used }] = await ds.query(`SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE booking_id = $1`, [bookingId]);
      expect(used).toBe(1);

      await adminCancel(bookingId).expect(200);

      expect(await walletBalance(customer)).toBe(50_000);
      const [{ count: after }] = await ds.query(`SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE booking_id = $1`, [bookingId]);
      expect(after).toBe(0);
      const again = await book(customer, hours(100), { couponCode: 'ADM10', pay: false });
      expect(again).toBeDefined();
      await adminCancel(again).expect(200);
    });

    it('is idempotent: a repeat or a parallel double cancel moves the wallet exactly once', async () => {
      const customer = await loginAs(app, '09160000014');
      await grantWallet('09160000014', 40_000);
      const bookingId = await book(customer, hours(120), { applyWalletBalance: true });

      const results = await Promise.all([adminCancel(bookingId), adminCancel(bookingId)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      await adminCancel(bookingId).expect(409);

      expect(await walletBalance(customer)).toBe(40_000);
    });

    it.each([
      ['completed', async (id: string) => { await startBookingInThePast(ds, id); await request(http()).patch(`/api/salons/mine/bookings/${id}`).set('Cookie', ownerCookie).send({ status: 'completed' }).expect(200); }],
      ['cancelled_by_user', async (id: string, c: string) => { await request(http()).post(`/api/bookings/${id}/cancel`).set('Cookie', c).expect(200); }],
    ])('refuses to cancel a %s booking (409) and changes nothing', async (status, bring) => {
      const phone = status === 'completed' ? '09160000015' : '09160000016';
      const customer = await loginAs(app, phone);
      const bookingId = await book(customer, hours(status === 'completed' ? 140 : 160));
      await bring(bookingId, customer);

      await adminCancel(bookingId).expect(409);
      const [row] = await ds.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
      expect(row.status).toBe(status);
    });

    it('is admin-only, validates the reason and 404s for an unknown booking', async () => {
      const customer = await loginAs(app, '09160000017');
      const bookingId = await book(customer, hours(180));

      await request(http()).post(`/api/admin/bookings/${bookingId}/cancel`).set('Cookie', customer).send({ reason: 'let me out' }).expect(403);
      await request(http()).post(`/api/admin/bookings/${bookingId}/cancel`).set('Cookie', ownerCookie).send({ reason: 'owner tries' }).expect(403);
      await request(http()).post(`/api/admin/bookings/${bookingId}/cancel`).send({ reason: 'anon' }).expect(401);
      await adminCancel(bookingId, '  ').expect(400);
      await adminCancel(bookingId, 'ab').expect(400);
      await request(http()).post(`/api/admin/bookings/${bookingId}/cancel`).set('Cookie', adminCookie).send({}).expect(400);
      await adminCancel('3f2b8c1e-5d7a-4a2b-9c3e-1a2b3c4d5e6f').expect(404);
      const [row] = await ds.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
      expect(row.status).toBe('confirmed');
    });

    it('the admin bookings list filters on the new status and reports depositPaid from the Payment row', async () => {
      const list = await request(http()).get('/api/admin/bookings?status=cancelled_by_admin').set('Cookie', adminCookie).expect(200);
      expect(list.body.total).toBeGreaterThan(0);
      expect(list.body.items.every((b: { status: string }) => b.status === 'cancelled_by_admin')).toBe(true);
      const paidThenRefunded = list.body.items.find((b: { payment: { status: string } | null }) => b.payment?.status === 'refunded');
      expect(paidThenRefunded.depositPaid).toBe(true);
      const unpaid = list.body.items.find((b: { payment: { status: string } | null }) => b.payment?.status === 'failed');
      expect(unpaid.depositPaid).toBe(false);
    });
  });

  describe('wallet credit on every refunded cancellation (audit finding 6)', () => {
    it('customer cancels in time: the wallet portion of the deposit comes back along with the refund', async () => {
      const customer = await loginAs(app, '09160000020');
      await grantWallet('09160000020', 50_000);
      const bookingId = await book(customer, hours(200), { applyWalletBalance: true });
      expect(await walletBalance(customer)).toBe(0);

      await request(http()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customer).expect(200);

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('refunded');
      expect(await walletBalance(customer)).toBe(50_000);
      // A second cancel is refused and cannot credit again.
      await request(http()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customer).expect(400);
      expect(await walletBalance(customer)).toBe(50_000);
    });

    it('the salon cancels: wallet credit comes back; a booking paid FULLY by wallet (no Payment row) is made whole too', async () => {
      const customer = await loginAs(app, '09160000021');
      await grantWallet('09160000021', 300_000); // more than the 200,000 deposit
      const bookingId = await book(customer, hours(220), { applyWalletBalance: true });
      const [booking] = await ds.query('SELECT status, deposit_amount, wallet_amount_used FROM bookings WHERE id = $1', [bookingId]);
      expect(booking).toMatchObject({ status: 'confirmed', deposit_amount: '0', wallet_amount_used: '200000' });
      expect(await walletBalance(customer)).toBe(100_000);

      await request(http()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', ownerCookie).expect(200);

      expect(await walletBalance(customer)).toBe(300_000);
    });

    it('a LATE customer cancellation forfeits the deposit and keeps the wallet portion spent', async () => {
      const customer = await loginAs(app, '09160000022');
      await grantWallet('09160000022', 50_000);
      const bookingId = await book(customer, hours(3), { applyWalletBalance: true }); // inside the 24h window

      await request(http()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customer).expect(200);

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('paid');
      expect(await walletBalance(customer)).toBe(0);
    });
  });

  describe('cancellation window snapshot', () => {
    afterEach(() => setConfig('cancellation_window_hours', 24));

    it('judges cancel by the window the booking was made under, in both directions', async () => {
      const customer = await loginAs(app, '09160000030');
      // Made under 24h; booked 30h out => refundable under its own terms.
      const generous = await book(customer, hours(30));
      // Made under 24h; booked 3h out => forfeit under its own terms.
      const strict = await book(customer, hours(3));
      const [{ cancellation_window_hours: frozen }] = await ds.query('SELECT cancellation_window_hours FROM bookings WHERE id = $1', [generous]);
      expect(frozen).toBe(24);

      // The platform now changes its policy: 48h would forfeit the first, 1h would refund the second.
      await setConfig('cancellation_window_hours', 48);
      await request(http()).post(`/api/bookings/${generous}/cancel`).set('Cookie', customer).expect(200);
      await setConfig('cancellation_window_hours', 1);
      await request(http()).post(`/api/bookings/${strict}/cancel`).set('Cookie', customer).expect(200);

      const rows = await ds.query('SELECT booking_id, status FROM payments WHERE booking_id = ANY($1)', [[generous, strict]]);
      const byBooking = Object.fromEntries(rows.map((r: { booking_id: string; status: string }) => [r.booking_id, r.status]));
      expect(byBooking[generous]).toBe('refunded');
      expect(byBooking[strict]).toBe('paid');
    });

    it('a customer reschedule is judged by the frozen window too', async () => {
      const customer = await loginAs(app, '09160000031');
      const bookingId = await book(customer, hours(240));
      await setConfig('cancellation_window_hours', 1000); // live rule would now refuse (240h < 1000h)

      await request(http())
        .post(`/api/bookings/${bookingId}/reschedule`)
        .set('Cookie', customer)
        .send({ startsAt: hours(250) })
        .expect(200);
    });

    it('a pre-snapshot row (NULL) falls back to the live config', async () => {
      const customer = await loginAs(app, '09160000032');
      const bookingId = await book(customer, hours(30));
      await ds.query('UPDATE bookings SET cancellation_window_hours = NULL WHERE id = $1', [bookingId]);
      await setConfig('cancellation_window_hours', 48);

      await request(http()).post(`/api/bookings/${bookingId}/cancel`).set('Cookie', customer).expect(200);

      const [payment] = await ds.query('SELECT status FROM payments WHERE booking_id = $1', [bookingId]);
      expect(payment.status).toBe('paid'); // 30h < the live 48h
    });
  });

  describe('prepaid and amount due on salon responses', () => {
    it('shows what the customer paid online and what the salon still collects, wallet portion included', async () => {
      const salon = await createApprovedSalonWithService(app, await loginAs(app, '09160000040'), { capacity: 5 });
      const salonOwner = await loginAs(app, '09160000040');
      const customer = await loginAs(app, '09160000041');
      await grantWallet('09160000041', 50_000);

      const plain = await book(customer, hours(24), { salon });
      const withWallet = await book(customer, hours(30), { salon, applyWalletBalance: true });
      const unpaid = await book(customer, hours(36), { salon, pay: false });

      const list = await request(http()).get('/api/salons/mine/bookings').set('Cookie', salonOwner).expect(200);
      const row = (id: string) => list.body.find((b: { id: string }) => b.id === id);
      // 500,000 price, 200,000 deposit (the minimum) captured => 300,000 left at the chair.
      expect(row(plain)).toMatchObject({ depositPaid: true, prepaidAmount: 200_000, amountDue: 300_000 });
      // 50,000 of the deposit came from the wallet, 150,000 from the gateway => still 300,000 due.
      expect(row(withWallet)).toMatchObject({ depositPaid: true, prepaidAmount: 150_000, amountDue: 300_000 });
      // Awaiting payment: nothing captured yet.
      expect(row(unpaid)).toMatchObject({ depositPaid: false, prepaidAmount: 0, amountDue: 500_000 });

      // After the salon cancels (full refund) nothing is prepaid and nothing is due.
      await request(http()).post(`/api/bookings/${plain}/cancel`).set('Cookie', salonOwner).expect(200);
      const after = await request(http()).get('/api/salons/mine/bookings').set('Cookie', salonOwner).expect(200);
      expect(after.body.find((b: { id: string }) => b.id === plain)).toMatchObject({ prepaidAmount: 0, amountDue: 0 });

      // The admin list tells the same story without implying anything was collected for the unpaid hold.
      const admin = await request(http()).get(`/api/admin/bookings?salonId=${salon.salonId}`).set('Cookie', adminCookie).expect(200);
      const adminRow = (id: string) => admin.body.items.find((b: { id: string }) => b.id === id);
      expect(adminRow(withWallet).depositPaid).toBe(true);
      expect(adminRow(unpaid).depositPaid).toBe(false);
    });
  });
});
