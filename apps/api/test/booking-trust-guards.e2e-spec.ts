import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BookingReminderJob } from '../src/booking/booking-reminder.job';
import { REDIS } from '../src/redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../src/sms/sms.provider';
import { createApprovedSalonWithService, createService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { startBookingInThePast } from './utils/booking-time';
import { resetDatabase, restoreBookingLimitDefaults } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * Trust & launch-readiness guards on the booking side, in FREE mode (online payment is off,
 * the seeded default): self-booking, abuse limits, completion/suspension guards, reminders,
 * review/referral eligibility of owner-entered bookings, and the salon-facing money fields.
 * The money-moving half (admin cancel, wallet return, window snapshot) is in
 * booking-admin-cancel.e2e-spec.ts, which runs with online payment on.
 */
describe('Booking trust guards (e2e, free mode)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  let adminCookie: string;

  // Salon A is the workhorse; its owner and a worker are used for the self-booking checks.
  let ownerA: string;
  let salonA: { salonId: string; categoryId: number; serviceId: string };
  const OWNER_A_PHONE = '09150000001';
  const WORKER_PHONE = '09150000002';

  const http = () => app.getHttpServer();
  const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  function book(cookie: string, salonId: string, serviceId: string, startsAt: string) {
    return request(http()).post('/api/bookings').set('Cookie', cookie).send({ salonId, serviceId, startsAt });
  }

  async function setConfig(key: string, value: number): Promise<void> {
    await ds.query(`UPDATE platform_config SET value = to_jsonb($2::int) WHERE key = $1`, [key, value]);
    await redis.del(`platform-config:${key}`);
  }

  async function newSalon(ownerPhone: string, over: { capacity?: number } = {}) {
    const cookie = await loginAs(app, ownerPhone);
    const salon = await createApprovedSalonWithService(app, cookie, { capacity: over.capacity ?? 5 });
    return { cookie, ...salon };
  }

  beforeAll(async () => {
    await resetDatabase();
    await restoreBookingLimitDefaults();
    app = await createTestApp();
    ds = app.get(DataSource);
    redis = app.get<Redis>(REDIS);
    adminCookie = await loginAsAdmin(app, '09150000099');
    ownerA = await loginAs(app, OWNER_A_PHONE);
    salonA = await createApprovedSalonWithService(app, ownerA, { capacity: 5 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('self-booking', () => {
    it('refuses the salon owner booking their own salon online', async () => {
      const res = await book(ownerA, salonA.salonId, salonA.serviceId, hours(24)).expect(400);
      expect(res.body.message).toBe('مالک سالن نمی‌تواند برای سالن خودش نوبت ثبت کند');
    });

    it('refuses an active worker booking their own salon online, but lets an INACTIVE (former) worker book', async () => {
      const created = await request(http())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerA)
        .send({ name: 'Worker One', phone: WORKER_PHONE })
        .expect(201);
      const workerCookie = await loginAs(app, WORKER_PHONE);

      const res = await book(workerCookie, salonA.salonId, salonA.serviceId, hours(24)).expect(400);
      expect(res.body.message).toBe('کارمند سالن نمی‌تواند برای همان سالن نوبت ثبت کند');

      await request(http())
        .patch(`/api/salons/mine/workers/${created.body.id}`)
        .set('Cookie', ownerA)
        .send({ active: false })
        .expect(200);
      await book(workerCookie, salonA.salonId, salonA.serviceId, hours(24)).expect(201);

      await request(http())
        .patch(`/api/salons/mine/workers/${created.body.id}`)
        .set('Cookie', ownerA)
        .send({ active: true })
        .expect(200);
    });

    it('refuses an owner-entered booking whose phone is the owner\'s or an active worker\'s, and accepts any other', async () => {
      const asOwner = await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', ownerA)
        .send({ phone: OWNER_A_PHONE, serviceId: salonA.serviceId, startsAt: hours(30) })
        .expect(400);
      expect(asOwner.body.message).toBe('مالک سالن نمی‌تواند برای سالن خودش نوبت ثبت کند');

      await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', ownerA)
        .send({ phone: WORKER_PHONE, serviceId: salonA.serviceId, startsAt: hours(30) })
        .expect(400);

      await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', ownerA)
        .send({ phone: '09150000003', serviceId: salonA.serviceId, startsAt: hours(30) })
        .expect(201);
    });
  });

  describe('abuse limits on online booking creation', () => {
    afterEach(async () => {
      await setConfig('booking_max_active_per_user', 5);
      await setConfig('booking_max_active_per_salon_per_user', 2);
    });

    it('caps active future bookings per customer at one salon (default 2) and frees the slot on cancel', async () => {
      const customer = await loginAs(app, '09150000010');
      const first = await book(customer, salonA.salonId, salonA.serviceId, hours(24)).expect(201);
      await book(customer, salonA.salonId, salonA.serviceId, hours(27)).expect(201);

      const third = await book(customer, salonA.salonId, salonA.serviceId, hours(30)).expect(400);
      expect(third.body.code).toBe('BOOKING_LIMIT_REACHED');
      expect(third.body.message).toBe('در هر سالن حداکثر 2 نوبت فعال می‌توانید داشته باشید');

      await request(http()).post(`/api/bookings/${first.body.booking.id}/cancel`).set('Cookie', customer).expect(200);
      await book(customer, salonA.salonId, salonA.serviceId, hours(30)).expect(201);
    });

    it('does not count past or finished bookings against the cap', async () => {
      const customer = await loginAs(app, '09150000011');
      const a = await book(customer, salonA.salonId, salonA.serviceId, hours(24)).expect(201);
      const b = await book(customer, salonA.salonId, salonA.serviceId, hours(27)).expect(201);
      // Both appointments are now behind us and the salon closed them out.
      await startBookingInThePast(ds, a.body.booking.id, 300);
      await startBookingInThePast(ds, b.body.booking.id, 200);
      await request(http()).patch(`/api/salons/mine/bookings/${a.body.booking.id}`).set('Cookie', ownerA).send({ status: 'completed' }).expect(200);

      await book(customer, salonA.salonId, salonA.serviceId, hours(24)).expect(201);
      await book(customer, salonA.salonId, salonA.serviceId, hours(27)).expect(201);
    });

    it('refuses an overlapping booking by the same customer, even at a different salon', async () => {
      const other = await newSalon('09150000020');
      const customer = await loginAs(app, '09150000012');
      await book(customer, salonA.salonId, salonA.serviceId, hours(40)).expect(201); // 60-minute service
      const overlap = await book(customer, other.salonId, other.serviceId, new Date(Date.now() + 40.5 * 3_600_000).toISOString()).expect(409);
      expect(overlap.body.code).toBe('CUSTOMER_DOUBLE_BOOKED');
      expect(overlap.body.message).toBe('در این بازه زمانی نوبت دیگری دارید');
      // Back-to-back is not an overlap.
      await book(customer, other.salonId, other.serviceId, new Date(Date.now() + 41 * 3_600_000).toISOString()).expect(201);
    });

    it('caps the customer\'s total active future bookings across salons (admin-configurable)', async () => {
      await setConfig('booking_max_active_per_user', 2);
      const s2 = await newSalon('09150000021');
      const s3 = await newSalon('09150000022');
      const customer = await loginAs(app, '09150000013');
      await book(customer, salonA.salonId, salonA.serviceId, hours(50)).expect(201);
      await book(customer, s2.salonId, s2.serviceId, hours(53)).expect(201);

      const third = await book(customer, s3.salonId, s3.serviceId, hours(56)).expect(400);
      expect(third.body.code).toBe('BOOKING_LIMIT_REACHED');
      expect(third.body.message).toContain('حداکثر 2 نوبت فعال');
    });

    it('is race-safe across salons: 8 parallel requests with a cap of 3 create exactly 3 bookings', async () => {
      await setConfig('booking_max_active_per_user', 3);
      const salons: Array<Awaited<ReturnType<typeof newSalon>>> = [];
      for (let i = 0; i < 8; i += 1) salons.push(await newSalon(`091500001${String(i).padStart(2, '0')}`));
      const customer = await loginAs(app, '09150000014');

      const results = await Promise.all(
        salons.map((s, i) => book(customer, s.salonId, s.serviceId, hours(60 + i * 3))),
      );

      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 400)).toHaveLength(5);
      const [{ count }] = await ds.query(
        `SELECT COUNT(*)::int AS count FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone = '09150000014'`,
      );
      expect(count).toBe(3);
    });

    it('is race-safe within one salon: 5 parallel requests with a per-salon cap of 2 never exceed 2', async () => {
      const customer = await loginAs(app, '09150000015');
      const results = await Promise.all(
        [0, 1, 2, 3, 4].map((i) => book(customer, salonA.salonId, salonA.serviceId, hours(80 + i * 3))),
      );

      expect(results.filter((r) => r.status === 201).length).toBeLessThanOrEqual(2);
      const [{ count }] = await ds.query(
        `SELECT COUNT(*)::int AS count FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.phone = '09150000015'`,
      );
      expect(count).toBeLessThanOrEqual(2);
    });

    it('rate-limits POST /bookings per user (429) without creating anything', async () => {
      const customer = await loginAs(app, '09150000016');
      const [{ id: userId }] = await ds.query(`SELECT id FROM users WHERE phone = '09150000016'`);
      await redis.set(`booking:create:rl:${userId}`, '15', 'EX', 600);

      await book(customer, salonA.salonId, salonA.serviceId, hours(100)).expect(429);
      const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE user_id = $1`, [userId]);
      expect(count).toBe(0);
    });

    it('the two caps are editable through PATCH /admin/config within 1-50 and 1-20 whole numbers', async () => {
      const patch = (key: string, value: number) =>
        request(http()).patch('/api/admin/config').set('Cookie', adminCookie).send({ updates: [{ key, value }] });

      await patch('booking_max_active_per_user', 0).expect(400);
      await patch('booking_max_active_per_user', 51).expect(400);
      await patch('booking_max_active_per_user', 2.5).expect(400);
      await patch('booking_max_active_per_salon_per_user', 21).expect(400);
      await patch('booking_max_active_per_salon_per_user', 0).expect(400);

      const ok = await patch('booking_max_active_per_user', 50).expect(200);
      expect(ok.body).toContainEqual({ key: 'booking_max_active_per_user', value: 50 });
      await patch('booking_max_active_per_salon_per_user', 20).expect(200);
    });
  });

  describe('recording an outcome', () => {
    async function confirmedBooking(customerPhone: string, startsInHours = 24) {
      const customer = await loginAs(app, customerPhone);
      const created = await book(customer, salonA.salonId, salonA.serviceId, hours(startsInHours)).expect(201);
      return { customer, bookingId: created.body.booking.id as string };
    }
    const mark = (bookingId: string, status: 'completed' | 'no_show') =>
      request(http()).patch(`/api/salons/mine/bookings/${bookingId}`).set('Cookie', ownerA).send({ status });

    it('refuses to complete a booking that has not started, and allows it once it has', async () => {
      const { bookingId } = await confirmedBooking('09150000030');

      const res = await mark(bookingId, 'completed').expect(400);
      expect(res.body.message).toBe('ثبت انجام‌شدن نوبت پیش از زمان شروع آن ممکن نیست');
      const [{ status }] = await ds.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
      expect(status).toBe('confirmed');

      await startBookingInThePast(ds, bookingId, 5);
      await mark(bookingId, 'completed').expect(200);
    });

    it('refuses completed and no_show with a 403 while the salon is suspended, and works again once reinstated', async () => {
      const done = await confirmedBooking('09150000031');
      const missed = await confirmedBooking('09150000032');
      await startBookingInThePast(ds, done.bookingId);
      await startBookingInThePast(ds, missed.bookingId);

      await ds.query(`UPDATE salons SET status = 'suspended' WHERE id = $1`, [salonA.salonId]);
      const c = await mark(done.bookingId, 'completed').expect(403);
      expect(c.body.message).toBe('تا زمانی که وضعیت سالن تایید‌شده نباشد، امکان ثبت نتیجه نوبت وجود ندارد');
      await mark(missed.bookingId, 'no_show').expect(403);
      const rows = await ds.query(`SELECT status FROM bookings WHERE id = ANY($1)`, [[done.bookingId, missed.bookingId]]);
      expect(rows.map((r: { status: string }) => r.status)).toEqual(['confirmed', 'confirmed']);

      await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonA.salonId]);
      await mark(done.bookingId, 'completed').expect(200);
      await mark(missed.bookingId, 'no_show').expect(200);
    });

    it('the no-show SMS does not claim a forfeited deposit when nothing was ever paid', async () => {
      const sms = app.get<SmsProvider>(SMS_PROVIDER);
      const spy = jest.spyOn(sms, 'send');
      const { bookingId } = await confirmedBooking('09150000033');
      await startBookingInThePast(ds, bookingId);
      spy.mockClear();

      await mark(bookingId, 'no_show').expect(200);

      const noShowSms = spy.mock.calls.find(([phone]) => phone === '09150000033');
      expect(noShowSms).toBeDefined();
      expect(noShowSms![1]).toContain('عدم حضور');
      expect(noShowSms![1]).not.toContain('بازگردانده');
      spy.mockRestore();
    });
  });

  describe('reminders', () => {
    it('never remind customers of a suspended salon, and still do once it is reinstated', async () => {
      const salon = await newSalon('09150000040');
      const customer = await loginAs(app, '09150000041');
      const created = await book(customer, salon.salonId, salon.serviceId, hours(2)).expect(201);
      const bookingId: string = created.body.booking.id;
      const sms = app.get<SmsProvider>(SMS_PROVIDER);
      const spy = jest.spyOn(sms, 'send');
      const job = app.get(BookingReminderJob);

      await ds.query(`UPDATE salons SET status = 'suspended' WHERE id = $1`, [salon.salonId]);
      await job.run();
      const [suspended] = await ds.query(`SELECT reminded_at FROM bookings WHERE id = $1`, [bookingId]);
      expect(suspended.reminded_at).toBeNull();
      expect(spy.mock.calls.some(([phone]) => phone === '09150000041')).toBe(false);

      await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salon.salonId]);
      await job.run();
      const [approved] = await ds.query(`SELECT reminded_at FROM bookings WHERE id = $1`, [bookingId]);
      expect(approved.reminded_at).not.toBeNull();
      expect(spy.mock.calls.some(([phone]) => phone === '09150000041')).toBe(true);
      spy.mockRestore();
    });
  });

  describe('owner-entered bookings cannot back reviews or referral rewards', () => {
    const CUSTOMER_PHONE = '09150000050';

    it('refuses a review of a manual booking (400, Persian) and reports reviewable=false; an online one is reviewable until reviewed', async () => {
      const customer = await loginAs(app, CUSTOMER_PHONE);

      const manual = await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', ownerA)
        .send({ phone: CUSTOMER_PHONE, serviceId: salonA.serviceId, startsAt: hours(120) })
        .expect(201);
      await startBookingInThePast(ds, manual.body.id);
      await request(http()).patch(`/api/salons/mine/bookings/${manual.body.id}`).set('Cookie', ownerA).send({ status: 'completed' }).expect(200);

      const refused = await request(http())
        .post('/api/reviews')
        .set('Cookie', customer)
        .send({ bookingId: manual.body.id, rating: 5 })
        .expect(400);
      expect(refused.body.message).toBe('این نوبت توسط خود سالن ثبت شده و امکان ثبت نظر ندارد');

      const online = await book(customer, salonA.salonId, salonA.serviceId, hours(130)).expect(201);
      const onlineId: string = online.body.booking.id;
      const flag = async (id: string) => {
        const list = await request(http()).get('/api/bookings/mine').set('Cookie', customer).expect(200);
        return list.body.find((b: { id: string }) => b.id === id).reviewable as boolean;
      };

      expect(await flag(onlineId)).toBe(false); // not completed yet
      await startBookingInThePast(ds, onlineId);
      await request(http()).patch(`/api/salons/mine/bookings/${onlineId}`).set('Cookie', ownerA).send({ status: 'completed' }).expect(200);

      expect(await flag(onlineId)).toBe(true);
      expect(await flag(manual.body.id)).toBe(false);
      const detail = await request(http()).get(`/api/bookings/${onlineId}`).set('Cookie', customer).expect(200);
      expect(detail.body.reviewable).toBe(true);

      await request(http()).post('/api/reviews').set('Cookie', customer).send({ bookingId: onlineId, rating: 4 }).expect(201);
      expect(await flag(onlineId)).toBe(false);
    });

    it('a manual booking completed for a referred customer does not qualify the referral; a real online booking does', async () => {
      await request(http())
        .patch('/api/admin/referral-reward-types/user')
        .set('Cookie', adminCookie)
        .send({
          enabled: true,
          referrerRewardKind: 'wallet_credit',
          referrerRewardValue: 20000,
          referredRewardKind: 'wallet_credit',
          referredRewardValue: 15000,
          qualifyingEvent: 'first_completed_booking',
        })
        .expect(200);
      const referrer = await loginAs(app, '09150000060');
      const code = (await request(http()).get('/api/referrals/my-code').set('Cookie', referrer).expect(200)).body.code;
      const referred = await loginAs(app, '09150000061', { referralCode: code });
      const status = async () =>
        (await request(http()).get('/api/referrals/mine').set('Cookie', referrer).expect(200)).body.items[0].status as string;
      expect(await status()).toBe('awaiting_qualifying_event');

      const manual = await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', ownerA)
        .send({ phone: '09150000061', serviceId: salonA.serviceId, startsAt: hours(140) })
        .expect(201);
      await startBookingInThePast(ds, manual.body.id);
      await request(http()).patch(`/api/salons/mine/bookings/${manual.body.id}`).set('Cookie', ownerA).send({ status: 'completed' }).expect(200);
      expect(await status()).toBe('awaiting_qualifying_event');

      const online = await book(referred, salonA.salonId, salonA.serviceId, hours(150)).expect(201);
      await startBookingInThePast(ds, online.body.booking.id);
      await request(http()).patch(`/api/salons/mine/bookings/${online.body.booking.id}`).set('Cookie', ownerA).send({ status: 'completed' }).expect(200);
      expect(await status()).toBe('reward_granted');
    });
  });

  describe('salon- and admin-facing money fields in free mode', () => {
    it('a free-mode booking shows nothing prepaid and the whole price still to collect; a quote service has no amountDue', async () => {
      const salon = await newSalon('09150000070');
      const quoteServiceId = await createService(
        app, salon.cookie, salon.categoryId, { pricingType: 'quote', name: 'Color' },
      );
      const customer = await loginAs(app, '09150000071');
      const created = await book(customer, salon.salonId, salon.serviceId, hours(24)).expect(201);

      const list = await request(http()).get('/api/salons/mine/bookings').set('Cookie', salon.cookie).expect(200);
      const row = list.body.find((b: { id: string }) => b.id === created.body.booking.id);
      expect(row).toMatchObject({ depositPaid: false, prepaidAmount: 0, amountDue: 500_000 });

      const manual = await request(http())
        .post('/api/salons/mine/bookings')
        .set('Cookie', salon.cookie)
        .send({ phone: '09150000072', serviceId: quoteServiceId, startsAt: hours(48), priceOverrideToman: 900_000 })
        .expect(201);
      expect(manual.body).toMatchObject({ depositPaid: false, prepaidAmount: 0, amountDue: null });

      const adminList = await request(http())
        .get(`/api/admin/bookings?salonId=${salon.salonId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      // depositAmount is what WOULD be owed; nothing was collected, and the row says so.
      const adminRow = adminList.body.items.find((b: { id: string }) => b.id === created.body.booking.id);
      expect(adminRow.depositAmount).toBeGreaterThan(0);
      expect(adminRow.depositPaid).toBe(false);
      expect(adminRow.payment).toBeNull();
    });
  });

  it('the booking snapshot records the cancellation window in force, and the admin list accepts the new terminal status as a filter', async () => {
    const customer = await loginAs(app, '09150000080');
    const created = await book(customer, salonA.salonId, salonA.serviceId, hours(200)).expect(201);
    expect(created.body.booking.cancellationWindowHours).toBe(24);

    await request(http()).get('/api/admin/bookings?status=cancelled_by_admin').set('Cookie', adminCookie).expect(200);
  });

});
