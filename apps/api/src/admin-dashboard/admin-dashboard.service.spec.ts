import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { AdminDashboardService, groupToday } from './admin-dashboard.service';

const NOW = new Date('2026-10-16T08:00:00.000Z');

function seriesRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ date: `d${i}`, created: 1, completed: i % 2 }));
}

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let query: jest.Mock;
  let redisGet: jest.Mock;

  const scalar = {
    today: '2026-10-16',
    salons_by_status: { pending: 2, approved: 5 },
    users_by_role: { customer: 10, provider: 4, admin: 1 },
    users_suspended: 1,
    pending_approval: 3,
    refund_pending: 1,
    open_reports: 2,
    pending_category_requests: 4,
    revenue_gross: '1500000',
    revenue_commission: '150000',
    revenue_rows: 3,
    alerts_critical: 1,
    alerts_warning: 2,
  };

  beforeEach(async () => {
    query = jest.fn((sql: string) => {
      if (sql.includes('salons_by_status')) return Promise.resolve([scalar]);
      if (sql.includes('generate_series')) return Promise.resolve(seriesRows(30));
      if (sql.includes('GROUP BY bk.status')) return Promise.resolve([{ status: 'confirmed', count: 2 }]);
      if (sql.includes('FROM plans')) {
        return Promise.resolve([{ plan_id: 'p1', plan_key: 'free', plan_name: 'رایگان', active_count: 7 }]);
      }
      return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    });
    redisGet = jest.fn().mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: DataSource, useValue: { query } },
        { provide: REDIS, useValue: { get: redisGet } },
      ],
    }).compile();
    service = moduleRef.get(AdminDashboardService);
  });

  it('maps the aggregates into the response, zero-filling missing statuses and roles', async () => {
    const result = await service.summary('admin-1', NOW);
    expect(result.today).toBe('2026-10-16');
    expect(result.salons).toEqual({ byStatus: { pending: 2, approved: 5, rejected: 0, suspended: 0 }, total: 7 });
    expect(result.users).toEqual({ byRole: { customer: 10, provider: 4, admin: 1 }, suspended: 1, total: 15 });
    expect(result.bookings.pendingApprovalNow).toBe(3);
    expect(result.payments.refundPending).toBe(1);
    expect(result.moderation).toEqual({ openReports: 2, pendingCategoryRequests: 4 });
    expect(result.revenueLast30Days).toEqual({ grossAmount: 1_500_000, commissionAmount: 150_000, accruals: 3 });
    expect(result.subscriptions.byPlan).toEqual([{ planId: 'p1', planKey: 'free', planName: 'رایگان', activeCount: 7 }]);
    expect(result.alerts).toEqual({ unreadCritical: 1, unreadWarning: 2 });
  });

  it('derives the 7- and 30-day totals from the zero-filled series', async () => {
    const result = await service.summary('admin-1', NOW);
    expect(result.bookings.series).toHaveLength(30);
    expect(result.bookings.last30Days).toEqual({ created: 30, completed: 15 });
    // last 7 entries are indices 23..29 -> completed at 23,25,27,29
    expect(result.bookings.last7Days).toEqual({ created: 7, completed: 4 });
  });

  it('passes now, the calling admin and the window to SQL (alert read state is per admin)', async () => {
    await service.summary('admin-7', NOW);
    const scalarCall = query.mock.calls.find(([sql]) => sql.includes('salons_by_status'));
    expect(scalarCall![1]).toEqual([NOW, 'admin-7', 30]);
    expect(scalarCall![0]).toContain("AT TIME ZONE 'Asia/Tehran'");
    expect(scalarCall![0]).toContain("type = 'commission_accrued'");
  });

  describe('backup status', () => {
    it("is 'missing' when the Redis key is absent", async () => {
      const { backup } = await service.summary('a', NOW);
      expect(backup).toEqual({ lastSuccessAt: null, status: 'missing', staleAfterHours: 27 });
    });
    it("is 'ok' within 27h and 'stale' past it", async () => {
      redisGet.mockResolvedValue(new Date(NOW.getTime() - 26 * 3_600_000).toISOString());
      expect((await service.summary('a', NOW)).backup.status).toBe('ok');
      redisGet.mockResolvedValue(new Date(NOW.getTime() - 28 * 3_600_000).toISOString());
      const { backup } = await service.summary('a', NOW);
      expect(backup.status).toBe('stale');
      expect(backup.lastSuccessAt).toBe(new Date(NOW.getTime() - 28 * 3_600_000).toISOString());
    });
    it("treats an unparseable value as 'missing', never as recent", async () => {
      redisGet.mockResolvedValue('not-a-date');
      expect((await service.summary('a', NOW)).backup).toMatchObject({ status: 'missing', lastSuccessAt: null });
    });
    it("reports 'unknown' instead of failing the whole dashboard when Redis errors", async () => {
      redisGet.mockRejectedValue(new Error('redis down'));
      expect((await service.summary('a', NOW)).backup.status).toBe('unknown');
    });
  });
});

describe('groupToday', () => {
  it('groups statuses: pending = approval+payment, cancelled = every dead status', () => {
    expect(
      groupToday([
        { status: 'pending_approval', count: 1 },
        { status: 'pending_payment', count: 2 },
        { status: 'confirmed', count: 3 },
        { status: 'completed', count: 4 },
        { status: 'no_show', count: 1 },
        { status: 'cancelled_by_user', count: 1 },
        { status: 'cancelled_by_admin', count: 1 },
        { status: 'rejected_by_salon', count: 1 },
        { status: 'expired', count: 1 },
      ]),
    ).toEqual({
      total: 15,
      pending: 3,
      confirmed: 3,
      completed: 4,
      noShow: 1,
      cancelled: 4,
      byStatus: {
        pending_approval: 1,
        pending_payment: 2,
        confirmed: 3,
        completed: 4,
        no_show: 1,
        cancelled_by_user: 1,
        cancelled_by_admin: 1,
        rejected_by_salon: 1,
        expired: 1,
      },
    });
  });
  it('is all zeros for an empty day', () => {
    expect(groupToday([])).toMatchObject({ total: 0, pending: 0, confirmed: 0, cancelled: 0, byStatus: {} });
  });
});
