import { Repository } from 'typeorm';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsEventRecord } from './analytics-event.entity';

// Two independent raw-select chains (totals, funnel) -- every link just returns itself,
// same makeXQb helper shape referrals.service.spec.ts already uses for its own raw
// getRawMany-backed queries.
function makeQb(getRawMany: jest.Mock) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany,
  };
}

function makeService(totalsRows: unknown[], funnelRows: unknown[]) {
  const totalsQb = makeQb(jest.fn().mockResolvedValue(totalsRows));
  const funnelQb = makeQb(jest.fn().mockResolvedValue(funnelRows));
  const createQueryBuilder = jest.fn().mockReturnValueOnce(totalsQb).mockReturnValueOnce(funnelQb);
  const events = { createQueryBuilder };
  const service = new AnalyticsAggregationService(events as unknown as Repository<AnalyticsEventRecord>);
  return { service, totalsQb, funnelQb };
}

describe('AnalyticsAggregationService.summary', () => {
  it('defaults the range to the last 30 days when no from/to is given', async () => {
    const { service } = makeService([], []);
    const now = new Date('2026-08-11T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    const result = await service.summary({});

    expect(result.to).toBe('2026-08-11T00:00:00.000Z');
    expect(result.from).toBe(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());
    jest.useRealTimers();
  });

  it('respects explicit from/to query params', async () => {
    const { service } = makeService([], []);

    const result = await service.summary({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });

    expect(result.from).toBe('2026-01-01T00:00:00.000Z');
    expect(result.to).toBe('2026-02-01T00:00:00.000Z');
  });

  it('maps totalsByEvent rows and coerces the raw string count to a number', async () => {
    const { service } = makeService(
      [
        { eventName: 'booking_started', count: '12' },
        { eventName: 'search_performed', count: '402' },
      ],
      [],
    );

    const result = await service.summary({});

    expect(result.totalsByEvent).toEqual([
      { eventName: 'booking_started', count: 12 },
      { eventName: 'search_performed', count: 402 },
    ]);
  });

  it('filters the funnel query to only booking_started/booking_confirmed/payment_succeeded', async () => {
    const { service, funnelQb } = makeService([], []);

    await service.summary({});

    expect(funnelQb.andWhere).toHaveBeenCalledWith('e.eventName IN (:...names)', {
      names: ['booking_started', 'booking_confirmed', 'payment_succeeded'],
    });
  });

  it('pivots (day, eventName, count) rows into one row per day with zero-filled funnel columns', async () => {
    const { service } = makeService(
      [],
      [
        { day: new Date('2026-08-01T00:00:00.000Z'), eventName: 'booking_started', count: '5' },
        { day: new Date('2026-08-01T00:00:00.000Z'), eventName: 'booking_confirmed', count: '3' },
        { day: new Date('2026-08-02T00:00:00.000Z'), eventName: 'booking_started', count: '2' },
      ],
    );

    const result = await service.summary({});

    expect(result.funnelByDay).toEqual([
      { date: '2026-08-01', booking_started: 5, booking_confirmed: 3, payment_succeeded: 0 },
      { date: '2026-08-02', booking_started: 2, booking_confirmed: 0, payment_succeeded: 0 },
    ]);
  });

  it('returns an empty funnelByDay when no funnel events occurred in range', async () => {
    const { service } = makeService([], []);

    const result = await service.summary({});

    expect(result.funnelByDay).toEqual([]);
  });
});
