import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { iranDateString, iranWallClockToInstant } from '../src/common/iran-time.util';
import { addDays } from '../src/booking/capacity.util';
import { REDIS } from '../src/redis/redis.module';
import { createApprovedSalonWithService, firstCategoryId } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { startBookingInThePast } from './utils/booking-time';
import { enableOnlinePayments, resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

/**
 * GET /admin/dashboard-summary against real rows: bookings and payments come from the
 * real booking + payment flow (so the commission ledger row is the real accrual), and only
 * the states the API cannot reach on demand (a past created_at, refund_pending, alert
 * notifications) are written directly.
 */
describe('Admin dashboard summary (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminCookie: string;
  let customerCookie: string;
  let ownerCookie: string;
  let salonId: string;
  let today: string;
  let yesterday: string;

  async function bookAndPay(serviceId: string, hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 3_600_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(302);
    return created.body.booking.id;
  }

  beforeAll(async () => {
    await resetDatabase();
    await enableOnlinePayments();
    app = await createTestApp();
    ds = app.get(DataSource);

    adminCookie = await loginAsAdmin(app, '09124440001');
    customerCookie = await loginAs(app, '09124440002');
    ownerCookie = await loginAs(app, '09124440003');
    await loginAs(app, '09124440004');
    await ds.query(`UPDATE users SET status = 'suspended' WHERE phone = '09124440004'`);

    let serviceId: string;
    ({ salonId, serviceId } = await createApprovedSalonWithService(app, ownerCookie, { name: 'Dashboard Salon' }));

    // A second, still-pending salon (POST /salons leaves it pending).
    const pendingOwnerCookie = await loginAs(app, '09124440005');
    await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', pendingOwnerCookie)
      .send({
        name: 'Pending Salon',
        genderTarget: 'women',
        address: 'Somewhere St, No. 9',
        city: 'Tehran',
        lat: 35.7,
        lng: 51.4,
        capacity: 1,
        categoryIds: [await firstCategoryId(app)],
      })
      .expect(201);

    today = iranDateString(new Date());
    yesterday = addDays(today, -1);

    // A: completed through the real flow (accrues the commission row), then pinned to
    // 00:01 Tehran today. B: refund_pending. C: pending_approval, created 23:59 Tehran
    // yesterday -- one minute either side of Tehran midnight, which is the same UTC date
    // (20:29Z / 20:31Z), so UTC bucketing would put both on one day.
    const a = await bookAndPay(serviceId, 24);
    await startBookingInThePast(ds, a);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${a}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    const todayStart = iranWallClockToInstant(today, 1);
    await ds.query(`UPDATE bookings SET starts_at = $2, ends_at = $2::timestamptz + interval '30 minutes' WHERE id = $1`, [
      a,
      todayStart,
    ]);

    const b = await bookAndPay(serviceId, 48);
    await ds.query(`UPDATE payments SET status = 'refund_pending' WHERE booking_id = $1`, [b]);

    const c = await bookAndPay(serviceId, 72);
    await ds.query(`UPDATE bookings SET status = 'pending_approval', created_at = $2 WHERE id = $1`, [
      c,
      iranWallClockToInstant(yesterday, 23 * 60 + 59),
    ]);

    const customerId = (await ds.query(`SELECT id FROM users WHERE phone = '09124440002'`))[0].id;
    const ownerId = (await ds.query(`SELECT id FROM users WHERE phone = '09124440003'`))[0].id;
    await ds.query(
      `INSERT INTO reports (reporter_id, salon_id, target_type, reason, status)
       VALUES ($1, $2, 'salon', 'open one', 'open'), ($1, $2, 'salon', 'closed one', 'resolved')`,
      [customerId, salonId],
    );
    await ds.query(
      `INSERT INTO category_requests (requester_id, salon_id, name, status)
       VALUES ($1, $2, 'ناخن', 'pending'), ($1, $2, 'مژه', 'rejected')`,
      [ownerId, salonId],
    );

    // Alerts: one unread critical, one critical this admin already read, one warning, one
    // pre-column alert (NULL -> warning), and a non-alert notification that never counts.
    const adminId = (await ds.query(`SELECT id FROM users WHERE phone = '09124440001'`))[0].id;
    await ds.query(
      `INSERT INTO admin_notifications (type, title, severity) VALUES
         ('alert', 'critical unread', 'critical'),
         ('alert', 'warning unread', 'warning'),
         ('alert', 'legacy alert', NULL),
         ('salon_resubmitted', 'not an alert', NULL)`,
    );
    const [{ id: readId }] = await ds.query(
      `INSERT INTO admin_notifications (type, title, severity) VALUES ('alert', 'critical read', 'critical') RETURNING id`,
    );
    await ds.query(`INSERT INTO admin_notification_reads (notification_id, admin_id) VALUES ($1, $2)`, [readId, adminId]);

    await app.get<Redis>(REDIS).set('backup:last-success', new Date(Date.now() - 3_600_000).toISOString());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous (401) and non-admin (403) callers', async () => {
    await request(app.getHttpServer()).get('/api/admin/dashboard-summary').expect(401);
    await request(app.getHttpServer()).get('/api/admin/dashboard-summary').set('Cookie', customerCookie).expect(403);
    await request(app.getHttpServer()).get('/api/admin/dashboard-summary').set('Cookie', ownerCookie).expect(403);
  });

  it('returns DB-computed counts for salons, users, queues and moderation', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/admin/dashboard-summary')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(body.today).toBe(today);
    expect(body.salons).toEqual({ byStatus: { pending: 1, approved: 1, rejected: 0, suspended: 0 }, total: 2 });
    // 09124440001 admin; 0003 + 0005 promoted to provider by creating a salon; 0002 + 0004 customers.
    expect(body.users).toEqual({ byRole: { customer: 2, provider: 2, admin: 1 }, suspended: 1, total: 5 });
    expect(body.bookings.pendingApprovalNow).toBe(1);
    expect(body.payments).toEqual({ refundPending: 1 });
    expect(body.moderation).toEqual({ openReports: 1, pendingCategoryRequests: 1 });
    expect(body.alerts).toEqual({ unreadCritical: 1, unreadWarning: 2 });
    expect(body.backup.status).toBe('ok');
    expect(body.backup.staleAfterHours).toBe(27);
  });

  it('buckets bookings by Tehran day, zero-fills 30 days, and splits today by status', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/admin/dashboard-summary')
      .set('Cookie', adminCookie)
      .expect(200);

    const series = body.bookings.series as Array<{ date: string; created: number; completed: number }>;
    expect(series).toHaveLength(30);
    expect(series[0].date).toBe(addDays(today, -29));
    expect(series[29]).toEqual({ date: today, created: 2, completed: 1 });
    expect(series[28]).toEqual({ date: yesterday, created: 1, completed: 0 });
    expect(series.slice(0, 28).every((d) => d.created === 0 && d.completed === 0)).toBe(true);
    expect(body.bookings.last7Days).toEqual({ created: 3, completed: 1 });
    expect(body.bookings.last30Days).toEqual({ created: 3, completed: 1 });
    expect(body.bookings.today).toMatchObject({ total: 1, completed: 1, pending: 0, confirmed: 0, byStatus: { completed: 1 } });
  });

  it('sums the commission ledger and groups active subscriptions by plan', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/admin/dashboard-summary')
      .set('Cookie', adminCookie)
      .expect(200);

    const [ledger] = await ds.query(
      `SELECT sum(gross_amount)::int AS gross, sum(commission_amount)::int AS commission
         FROM financial_transactions WHERE type = 'commission_accrued'`,
    );
    expect(ledger.gross).toBeGreaterThan(0);
    expect(body.revenueLast30Days).toEqual({ grossAmount: ledger.gross, commissionAmount: ledger.commission, accruals: 1 });

    const byPlan = body.subscriptions.byPlan as Array<{ planKey: string; activeCount: number }>;
    expect(byPlan.reduce((n, p) => n + p.activeCount, 0)).toBe(2); // both salons got the default plan on create
    expect(byPlan.every((p) => typeof p.planKey === 'string')).toBe(true);
  });

  it('reports a stale and a missing backup', async () => {
    const redis = app.get<Redis>(REDIS);
    await redis.set('backup:last-success', new Date(Date.now() - 30 * 3_600_000).toISOString());
    let res = await request(app.getHttpServer()).get('/api/admin/dashboard-summary').set('Cookie', adminCookie).expect(200);
    expect(res.body.backup.status).toBe('stale');
    await redis.del('backup:last-success');
    res = await request(app.getHttpServer()).get('/api/admin/dashboard-summary').set('Cookie', adminCookie).expect(200);
    expect(res.body.backup).toEqual({ lastSuccessAt: null, status: 'missing', staleAfterHours: 27 });
  });

  it('exposes severity on GET /admin/notifications (stored for alerts, info otherwise)', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Cookie', adminCookie)
      .expect(200);
    const byTitle = Object.fromEntries(
      (body.items as Array<{ title: string; severity: string }>).map((n) => [n.title, n.severity]),
    );
    expect(byTitle).toMatchObject({
      'critical unread': 'critical',
      'critical read': 'critical',
      'warning unread': 'warning',
      'legacy alert': 'warning',
      'not an alert': 'info',
    });
  });
});
