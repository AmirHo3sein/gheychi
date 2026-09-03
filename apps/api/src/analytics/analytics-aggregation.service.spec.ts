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

describe('AnalyticsAggregationService.salonFunnel', () => {
  function makeFunnelService(rows: unknown[]) {
    const qb = makeQb(jest.fn().mockResolvedValue(rows));
    const events = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const service = new AnalyticsAggregationService(events as unknown as Repository<AnalyticsEventRecord>);
    return { service, qb };
  }

  const FROM = new Date('2026-08-01T00:00:00.000Z');
  const TO = new Date('2026-08-31T00:00:00.000Z');

  it('scopes the query to the given salon -- the query shape IS the access check', async () => {
    const { service, qb } = makeFunnelService([]);

    await service.salonFunnel('salon-1', FROM, TO);

    expect(qb.where).toHaveBeenCalledWith('e.salonId = :salonId', { salonId: 'salon-1' });
  });

  it('queries exactly the salon-attributable funnel stages, in order', async () => {
    const { service, qb } = makeFunnelService([]);

    await service.salonFunnel('salon-1', FROM, TO);

    // payment_succeeded joined the list once its emit site started carrying salonId
    // (2026-09-03); rows written before then have salon_id NULL and stay invisible here.
    expect(qb.andWhere).toHaveBeenCalledWith('e.eventName IN (:...names)', {
      names: ['salon_profile_viewed', 'booking_started', 'payment_succeeded', 'booking_confirmed'],
    });
  });

  it('computes each stage conversion against the stage before it', async () => {
    const { service } = makeFunnelService([
      { eventName: 'salon_profile_viewed', count: '200' },
      { eventName: 'booking_started', count: '50' },
      { eventName: 'payment_succeeded', count: '30' },
      { eventName: 'booking_confirmed', count: '25' },
    ]);

    const result = await service.salonFunnel('salon-1', FROM, TO);

    expect(result.stages).toEqual([
      { stage: 'salon_profile_viewed', count: 200, conversionFromPreviousPercent: null },
      { stage: 'booking_started', count: 50, conversionFromPreviousPercent: 25 },
      { stage: 'payment_succeeded', count: 30, conversionFromPreviousPercent: 60 },
      { stage: 'booking_confirmed', count: 25, conversionFromPreviousPercent: 83 },
    ]);
  });

  it('reports a null conversion (not 0%) when the previous stage has no data at all', async () => {
    // A salon whose bookings all come in by phone/QR without the profile page being hit:
    // "no denominator" must never be rendered as "0% of viewers booked".
    const { service } = makeFunnelService([{ eventName: 'booking_started', count: '4' }]);

    const result = await service.salonFunnel('salon-1', FROM, TO);

    expect(result.stages[1]).toEqual({ stage: 'booking_started', count: 4, conversionFromPreviousPercent: null });
  });

  it('returns every stage at zero when the salon has no events yet, rather than an empty list', async () => {
    const { service } = makeFunnelService([]);

    const result = await service.salonFunnel('salon-1', FROM, TO);

    expect(result.stages.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    expect(result.stages.every((s) => s.conversionFromPreviousPercent === null)).toBe(true);
    expect(result).toMatchObject({ from: FROM.toISOString(), to: TO.toISOString() });
  });
});
