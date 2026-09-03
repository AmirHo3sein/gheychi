import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService, MAX_PAGE_SIZE } from './admin-bookings.service';
import { Booking } from './booking.entity';
import { AdminBookingQueryDto } from './dto/admin-booking-query.dto';

/**
 * Records every clause the service composes onto the query builder, so the filter tests
 * assert on the ACTUAL SQL fragments + parameters rather than on a stubbed return value
 * (which would pass even if a filter were dropped entirely).
 */
interface QueryBuilderMock {
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  andWhere: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getCount: jest.Mock;
  getRawMany: jest.Mock;
  wheres: Array<{ clause: string; params: Record<string, unknown> | undefined }>;
  offsetValue: number | null;
  limitValue: number | null;
  callOrder: string[];
}

function makeQueryBuilder(): QueryBuilderMock {
  const qb = {
    wheres: [] as Array<{ clause: string; params: Record<string, unknown> | undefined }>,
    offsetValue: null as number | null,
    limitValue: null as number | null,
    callOrder: [] as string[],
  } as QueryBuilderMock;

  qb.leftJoin = jest.fn(() => qb);
  qb.select = jest.fn(() => qb);
  qb.addSelect = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.addOrderBy = jest.fn(() => qb);
  qb.andWhere = jest.fn((clause: string, params?: Record<string, unknown>) => {
    qb.wheres.push({ clause, params });
    return qb;
  });
  qb.offset = jest.fn((value: number) => {
    qb.offsetValue = value;
    qb.callOrder.push('offset');
    return qb;
  });
  qb.limit = jest.fn((value: number) => {
    qb.limitValue = value;
    qb.callOrder.push('limit');
    return qb;
  });
  qb.getCount = jest.fn(async () => {
    qb.callOrder.push('getCount');
    return 0;
  });
  qb.getRawMany = jest.fn(async () => [] as Record<string, unknown>[]);
  return qb;
}

/**
 * A raw driver row exactly as pg hands it back for this query's projection: bigints as
 * STRINGS (a raw-selected column never runs the entity's bigintToNumber transformer) and
 * timestamps as Date objects.
 */
const rawRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'booking-1',
  startsAt: new Date('2026-09-01T09:00:00.000Z'),
  endsAt: new Date('2026-09-01T09:30:00.000Z'),
  status: 'confirmed',
  confirmationMode: 'automatic',
  source: 'online',
  attributionSource: 'qr',
  priceSnapshot: '500000',
  depositAmount: '100000',
  createdAt: new Date('2026-08-30T09:00:00.000Z'),
  salonId: 'salon-1',
  serviceId: 'service-1',
  workerId: 'worker-1',
  userId: 'user-1',
  salonName: 'سالن نمونه',
  serviceName: 'کوتاهی مو',
  workerName: 'مریم',
  customerName: 'زهرا',
  customerPhone: '09120000001',
  paymentStatus: null,
  paymentAmount: null,
  paymentPaidAt: null,
  paymentRefundRequestedAt: null,
  paymentRefundedAt: null,
  paymentRefundRefId: null,
  commissionAmount: null,
  ...overrides,
});

describe('AdminBookingsService', () => {
  let service: AdminBookingsService;
  let qb: QueryBuilderMock;

  beforeEach(async () => {
    qb = makeQueryBuilder();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminBookingsService,
        { provide: getRepositoryToken(Booking), useValue: { createQueryBuilder: jest.fn(() => qb) } },
      ],
    }).compile();
    service = moduleRef.get(AdminBookingsService);
  });

  describe('filter composition', () => {
    it('adds no WHERE clause at all when no filter is supplied', async () => {
      await service.list({});
      expect(qb.wheres).toHaveLength(0);
    });

    it('composes every supplied filter as its own parameterised clause', async () => {
      await service.list({
        status: 'confirmed',
        salonId: 'salon-1',
        userId: 'user-1',
        confirmationMode: 'manual_approval',
        source: 'manual',
        paymentStatus: 'refund_pending',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T23:59:59.999Z',
      });

      expect(qb.wheres.map((w) => w.clause)).toEqual([
        'booking.status = :status',
        'booking.salonId = :salonId',
        'booking.userId = :userId',
        'booking.confirmationMode = :confirmationMode',
        'booking.source = :source',
        // Reads through the payment JOIN, not a booking column -- a booking with no
        // Payment row must not match any paymentStatus value.
        'payment.status = :paymentStatus',
        'booking.startsAt >= :from',
        'booking.startsAt <= :to',
      ]);
      expect(Object.assign({}, ...qb.wheres.map((w) => w.params))).toEqual({
        status: 'confirmed',
        salonId: 'salon-1',
        userId: 'user-1',
        confirmationMode: 'manual_approval',
        source: 'manual',
        paymentStatus: 'refund_pending',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T23:59:59.999Z',
      });
    });

    it('orders by startsAt DESC with a deterministic id tiebreaker', async () => {
      await service.list({});
      expect(qb.orderBy).toHaveBeenCalledWith('booking.startsAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('booking.id', 'DESC');
    });

    it('aggregates commission in a subquery rather than a sixth join', async () => {
      await service.list({});
      // Joining financial_transactions would duplicate any booking carrying a
      // commission_reversed correction row and inflate `total`.
      const joinedEntities = qb.leftJoin.mock.calls.map((call) => call[1]);
      expect(joinedEntities).toEqual(['salon', 'service', 'worker', 'customer', 'payment']);
      const commissionSelect = qb.addSelect.mock.calls.find((call) => call[1] === 'commissionAmount');
      expect(String(commissionSelect?.[0])).toContain('financial_transactions');
      expect(String(commissionSelect?.[0])).toContain('commission_reversed');
    });
  });

  describe('pagination bounds', () => {
    it('defaults to page 1 / pageSize 20', async () => {
      const result = await service.list({});
      expect(qb.offsetValue).toBe(0);
      expect(qb.limitValue).toBe(20);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('translates page/pageSize into offset/limit', async () => {
      await service.list({ page: 3, pageSize: 25 });
      expect(qb.offsetValue).toBe(50);
      expect(qb.limitValue).toBe(25);
    });

    it('clamps an out-of-range pageSize to the ceiling and a page below 1 up to 1', async () => {
      // The DTO's @Max/@Min already reject these over HTTP -- this pins the service's own
      // defence for any future non-HTTP caller.
      const result = await service.list({ page: 0, pageSize: 5000 });
      expect(qb.limitValue).toBe(MAX_PAGE_SIZE);
      expect(qb.offsetValue).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(MAX_PAGE_SIZE);
    });

    it('counts before applying offset/limit, so `total` spans every page', async () => {
      qb.getCount.mockResolvedValueOnce(137);
      const result = await service.list({ page: 2, pageSize: 20 });
      expect(result.total).toBe(137);
      expect(qb.callOrder.indexOf('getCount')).toBeLessThan(qb.callOrder.indexOf('offset'));
      expect(qb.callOrder.indexOf('getCount')).toBeLessThan(qb.callOrder.indexOf('limit'));
    });
  });

  describe('row projection', () => {
    it('maps a raw driver row into the row shape, converting string bigints to numbers', async () => {
      qb.getCount.mockResolvedValueOnce(1);
      qb.getRawMany.mockResolvedValueOnce([
        rawRow({
          paymentStatus: 'refund_pending',
          paymentAmount: '100000',
          paymentPaidAt: new Date('2026-08-30T09:05:00.000Z'),
          paymentRefundRequestedAt: new Date('2026-08-31T10:00:00.000Z'),
          commissionAmount: '15000',
        }),
      ]);

      const { items } = await service.list({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'booking-1',
        salonName: 'سالن نمونه',
        serviceName: 'کوتاهی مو',
        workerName: 'مریم',
        customerName: 'زهرا',
        customerPhone: '09120000001',
        status: 'confirmed',
        confirmationMode: 'automatic',
        source: 'online',
        attributionSource: 'qr',
        // The strings above, not "500000"/"100000" passed through verbatim.
        priceSnapshot: 500_000,
        depositAmount: 100_000,
        commissionAmount: 15_000,
      });
      expect(items[0].payment).toEqual({
        status: 'refund_pending',
        amount: 100_000,
        paidAt: new Date('2026-08-30T09:05:00.000Z'),
        refundRequestedAt: new Date('2026-08-31T10:00:00.000Z'),
        refundedAt: null,
        refundRefId: null,
      });
    });

    it('reports a booking with no payment row as payment:null and commission:null, never zero', async () => {
      // pending_approval bookings genuinely have no Payment row (doc 28's central
      // guarantee). Rendering that as "0 تومان paid" would be a lie, not a rounding.
      qb.getCount.mockResolvedValueOnce(1);
      qb.getRawMany.mockResolvedValueOnce([
        rawRow({
          status: 'pending_approval',
          confirmationMode: 'manual_approval',
          workerId: null,
          workerName: null,
          customerName: null,
          attributionSource: null,
        }),
      ]);

      const { items } = await service.list({});
      expect(items[0].payment).toBeNull();
      expect(items[0].commissionAmount).toBeNull();
      expect(items[0].workerName).toBeNull();
      expect(items[0].customerName).toBeNull();
      expect(items[0].attributionSource).toBeNull();
    });

    it('returns one row per raw row, in the order the query produced them', async () => {
      // Nothing regroups or dedupes here -- the projection is flat precisely so a page of
      // N rows can never collapse into fewer (the failure mode entity hydration had).
      qb.getCount.mockResolvedValueOnce(2);
      qb.getRawMany.mockResolvedValueOnce([
        rawRow({ id: 'booking-b', customerPhone: '09120000009' }),
        rawRow({ id: 'booking-a', customerPhone: '09120000001' }),
      ]);

      const { items } = await service.list({});
      expect(items.map((i) => [i.id, i.customerPhone])).toEqual([
        ['booking-b', '09120000009'],
        ['booking-a', '09120000001'],
      ]);
    });
  });
});

describe('AdminBookingQueryDto', () => {
  const validateDto = (payload: Record<string, unknown>) =>
    validate(plainToInstance(AdminBookingQueryDto, payload, { enableImplicitConversion: false }));

  it('accepts an entirely empty query', async () => {
    expect(await validateDto({})).toHaveLength(0);
  });

  it('rejects a status outside the BookingStatus union', async () => {
    const errors = await validateDto({ status: 'totally_made_up' });
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });

  it('rejects a non-UUID salonId/userId', async () => {
    expect((await validateDto({ salonId: 'not-a-uuid' })).map((e) => e.property)).toEqual(['salonId']);
    expect((await validateDto({ userId: 'not-a-uuid' })).map((e) => e.property)).toEqual(['userId']);
  });

  it('rejects a non-ISO date range', async () => {
    expect((await validateDto({ from: '1404/06/10' })).map((e) => e.property)).toEqual(['from']);
  });

  it('rejects a pageSize past the ceiling, so a single request cannot ask for the whole table', async () => {
    expect((await validateDto({ pageSize: 101 })).map((e) => e.property)).toEqual(['pageSize']);
    expect((await validateDto({ pageSize: 0 })).map((e) => e.property)).toEqual(['pageSize']);
    expect(await validateDto({ pageSize: 100, page: 1 })).toHaveLength(0);
  });
});

describe('AdminBookingsController', () => {
  it('delegates straight to the service and exposes no mutation route', () => {
    const list = jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const controller = new AdminBookingsController({ list } as unknown as AdminBookingsService);
    const query: AdminBookingQueryDto = { status: 'confirmed' };
    void controller.list(query);
    expect(list).toHaveBeenCalledWith(query);

    // Read-only by construction: booking invariants live in BookingsService's state
    // machine, and a generic admin write route here would bypass them. This pins that
    // there is exactly one handler on the class.
    const handlers = Object.getOwnPropertyNames(AdminBookingsController.prototype).filter((n) => n !== 'constructor');
    expect(handlers).toEqual(['list']);
  });
});
