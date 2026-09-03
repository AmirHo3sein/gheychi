import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CrmService } from './crm.service';
import { CustomerNote } from './customer-note.entity';

describe('CrmService', () => {
  let service: CrmService;
  let dataSourceQuery: jest.Mock;
  let notesRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    dataSourceQuery = jest.fn();
    notesRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'note-1', ...v })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: DataSource, useValue: { query: dataSourceQuery } },
        { provide: getRepositoryToken(CustomerNote), useValue: notesRepo },
      ],
    }).compile();
    service = moduleRef.get(CrmService);
  });

  describe('listCustomers', () => {
    function row(overrides: Record<string, unknown> = {}) {
      return {
        user_id: 'u1',
        name: 'Ali',
        phone: '0912',
        bookings_count: '3',
        completed_count: '2',
        visits_count: '2',
        first_visit_at: new Date('2026-06-01T10:00:00.000Z'),
        last_visit_at: new Date('2026-08-01T10:00:00.000Z'),
        gross_value: '900000',
        segment: 'returning',
        total_count: '1',
        ...overrides,
      };
    }

    it('maps aggregated rows, including the new firstVisitAt/visitsCount fields', async () => {
      dataSourceQuery.mockResolvedValueOnce([row()]);

      const result = await service.listCustomers('salon-1');

      expect(result.items[0]).toEqual({
        userId: 'u1',
        name: 'Ali',
        phone: '0912',
        bookingsCount: 3,
        completedCount: 2,
        visitsCount: 2,
        firstVisitAt: '2026-06-01T10:00:00.000Z',
        lastVisitAt: '2026-08-01T10:00:00.000Z',
        grossValue: 900_000,
        segment: 'returning',
      });
    });

    it('takes the segment from SQL, so a filtered page and its total always agree', async () => {
      dataSourceQuery.mockResolvedValueOnce([row({ segment: 'lapsed' })]);

      const result = await service.listCustomers('salon-1', { segment: 'lapsed' });

      expect(result.items[0]!.segment).toBe('lapsed');
      expect(dataSourceQuery.mock.calls[0]![1]).toContain('lapsed');
    });

    it('derives lastVisitAt/firstVisitAt only from PAST, non-cancelled bookings', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);
      await service.listCustomers('salon-1');

      const sql: string = dataSourceQuery.mock.calls[0]![0];
      // The bug this replaced: a bare MAX(starts_at) over every status, which reported a
      // future appointment as a past visit and fed that straight into the segmentation.
      expect(sql).toContain("MAX(b.starts_at) FILTER (WHERE b.starts_at < now() AND b.status IN ('confirmed', 'completed'))");
      expect(sql).toContain("MIN(b.starts_at) FILTER (WHERE b.starts_at < now() AND b.status IN ('confirmed', 'completed'))");
    });

    it('scopes the query to the given salon only', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);
      await service.listCustomers('salon-42');
      expect(dataSourceQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE b.salon_id = $1'),
        expect.arrayContaining(['salon-42']),
      );
    });

    it('defaults to page 1 of 20, sorted by most recent visit with a stable tiebreaker', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);

      const result = await service.listCustomers('salon-1');

      const [sql, params] = dataSourceQuery.mock.calls[0]!;
      expect(sql).toContain('ORDER BY last_visit_at DESC NULLS LAST, user_id ASC');
      expect(params).toEqual(['salon-1', null, null, 20, 0]);
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 0 });
    });

    it('translates page/pageSize into LIMIT/OFFSET', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);

      await service.listCustomers('salon-1', { page: 3, pageSize: 25 });

      expect(dataSourceQuery.mock.calls[0]![1]).toEqual(['salon-1', null, null, 25, 50]);
    });

    it('reads the filtered total off the window function, not the page length', async () => {
      dataSourceQuery.mockResolvedValueOnce([row({ total_count: '137' })]);

      const result = await service.listCustomers('salon-1');

      expect(result.total).toBe(137);
      expect(result.items).toHaveLength(1);
    });

    it('escapes LIKE wildcards in the search text, so "%" is a literal and not "match everything"', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);

      await service.listCustomers('salon-1', { q: '50%' });

      expect(dataSourceQuery.mock.calls[0]![1][1]).toBe('%50\\%%');
    });

    it('searches over both name and phone', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);
      await service.listCustomers('salon-1', { q: 'علی' });

      const sql: string = dataSourceQuery.mock.calls[0]![0];
      expect(sql).toContain('name ILIKE $2');
      expect(sql).toContain('phone ILIKE $2');
    });

    it('only accepts a whitelisted sort key, never raw caller text', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);
      await service.listCustomers('salon-1', { sort: 'value' });

      expect(dataSourceQuery.mock.calls[0]![0]).toContain('ORDER BY gross_value DESC, user_id ASC');
    });
  });

  describe('getCustomerDetail', () => {
    it('404s when the customer has no booking at this salon (ownership isolation)', async () => {
      dataSourceQuery.mockResolvedValueOnce([]); // bookings query returns nothing
      await expect(service.getCustomerDetail('salon-1', 'stranger')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the customer, their booking history, and notes', async () => {
      dataSourceQuery
        .mockResolvedValueOnce([
          { id: 'b1', starts_at: '2026-08-01T10:00:00.000Z', status: 'completed', price_snapshot: '300000', service_name: 'کوتاهی مو' },
        ])
        .mockResolvedValueOnce([{ id: 'u1', name: 'Ali', phone: '0912' }]);
      notesRepo.find.mockResolvedValueOnce([{ id: 'n1', note: 'مشتری خوب' }]);

      const result = await service.getCustomerDetail('salon-1', 'u1');

      expect(result.customer).toEqual({ id: 'u1', name: 'Ali', phone: '0912' });
      expect(result.bookings).toEqual([
        { id: 'b1', startsAt: '2026-08-01T10:00:00.000Z', status: 'completed', priceSnapshot: 300000, serviceName: 'کوتاهی مو' },
      ]);
      expect(result.notes).toEqual([{ id: 'n1', note: 'مشتری خوب' }]);
    });
  });

  describe('getCustomerContact', () => {
    it('404s when the customer does not belong to this salon', async () => {
      dataSourceQuery.mockResolvedValueOnce([]); // ownership check finds nothing
      await expect(service.getCustomerContact('salon-1', 'stranger')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns just the identity, not booking history or notes', async () => {
      dataSourceQuery
        .mockResolvedValueOnce([{ '?column?': 1 }]) // ownership check
        .mockResolvedValueOnce([{ id: 'u1', name: 'Ali', phone: '0912' }]);
      await expect(service.getCustomerContact('salon-1', 'u1')).resolves.toEqual({ id: 'u1', name: 'Ali', phone: '0912' });
    });
  });

  describe('addNote', () => {
    it('404s when the customer does not belong to this salon', async () => {
      dataSourceQuery.mockResolvedValueOnce([]); // ownership check finds nothing
      await expect(service.addNote('salon-1', 'stranger', 'owner-1', 'یادداشت')).rejects.toBeInstanceOf(NotFoundException);
      expect(notesRepo.save).not.toHaveBeenCalled();
    });

    it('saves the note once ownership is confirmed', async () => {
      dataSourceQuery.mockResolvedValueOnce([{ '?column?': 1 }]);
      await service.addNote('salon-1', 'u1', 'owner-1', 'یادداشت خوب');
      expect(notesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ salonId: 'salon-1', customerId: 'u1', createdBy: 'owner-1', note: 'یادداشت خوب' }),
      );
    });
  });

  describe('deleteNote', () => {
    it('404s when no matching note is found (wrong salon/customer/id)', async () => {
      notesRepo.delete.mockResolvedValueOnce({ affected: 0 });
      await expect(service.deleteNote('salon-1', 'u1', 'note-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes scoped to salon+customer+id, never just the raw note id', async () => {
      await service.deleteNote('salon-1', 'u1', 'note-1');
      expect(notesRepo.delete).toHaveBeenCalledWith({ id: 'note-1', salonId: 'salon-1', customerId: 'u1' });
    });
  });

  describe('getDashboardSummary', () => {
    const FROM = new Date('2026-08-01T00:00:00.000Z');
    const TO = new Date('2026-08-31T00:00:00.000Z');
    // The previous period is the same length, ending exactly where this one starts.
    const PREV_FROM = new Date('2026-07-02T00:00:00.000Z');

    interface PeriodRows {
      gross?: string;
      bookings_count?: string;
      distinct_customers?: string;
      completed_count?: string;
      cancelled_count?: string;
      no_show_count?: string;
      collected?: string;
      commission?: string;
      new_customers?: string;
    }

    /**
     * Routes each query by what it selects rather than by call order -- the service fires
     * twelve queries (four per period, plus the three breakdowns) and an order-coupled mock
     * would break on any reordering without saying anything useful about behavior.
     */
    function stubDashboard(current: PeriodRows, previous: PeriodRows = {}, extras: Record<string, unknown[]> = {}) {
      dataSourceQuery.mockImplementation((sql: string, params: unknown[]) => {
        const period = (params[1] as Date).getTime() === FROM.getTime() ? current : previous;
        if (sql.includes('no_show_count')) {
          return Promise.resolve([
            {
              gross: period.gross ?? '0',
              bookings_count: period.bookings_count ?? '0',
              distinct_customers: period.distinct_customers ?? '0',
              completed_count: period.completed_count ?? '0',
              cancelled_count: period.cancelled_count ?? '0',
              no_show_count: period.no_show_count ?? '0',
            },
          ]);
        }
        if (sql.includes('FROM payments')) return Promise.resolve([{ collected: period.collected ?? '0' }]);
        if (sql.includes('financial_transactions')) return Promise.resolve([{ commission: period.commission ?? '0' }]);
        if (sql.includes('first_booked_at')) return Promise.resolve([{ new_customers: period.new_customers ?? '0' }]);
        if (sql.includes('salon_services')) return Promise.resolve(extras.topServices ?? []);
        if (sql.includes('workers w')) return Promise.resolve(extras.topWorkers ?? []);
        if (sql.includes('EXTRACT(DOW')) return Promise.resolve(extras.weekday ?? []);
        if (sql.includes('EXTRACT(HOUR')) return Promise.resolve(extras.hour ?? []);
        throw new Error(`unexpected query: ${sql}`);
      });
    }

    it('computes estimatedSalonRevenue as grossBookingValue minus commission, distinct from onlineCollected', async () => {
      stubDashboard({ gross: '5000000', bookings_count: '10', collected: '1000000', commission: '100000' });

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result).toMatchObject({
        from: FROM.toISOString(),
        to: TO.toISOString(),
        bookingsCount: 10,
        grossBookingValue: 5_000_000,
        onlineCollected: 1_000_000,
        commission: 100_000,
        estimatedSalonRevenue: 4_900_000,
      });
    });

    it('reports the same figures for the immediately-preceding window of equal length', async () => {
      stubDashboard(
        { gross: '5000000', bookings_count: '10' },
        { gross: '2000000', bookings_count: '4' },
      );

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result.previous).toMatchObject({
        from: PREV_FROM.toISOString(),
        to: FROM.toISOString(),
        bookingsCount: 4,
        grossBookingValue: 2_000_000,
      });
    });

    it('splits distinct customers into new vs returning, and never lets returning go negative', async () => {
      stubDashboard({ bookings_count: '10', distinct_customers: '8', new_customers: '3' });

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result).toMatchObject({ distinctCustomers: 8, newCustomers: 3, returningCustomers: 5, repeatRatePercent: 63 });
    });

    it('reports zero (not NaN) for the averages when nothing happened in the window', async () => {
      stubDashboard({});

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result).toMatchObject({ averageBookingValue: 0, repeatRatePercent: 0, busiestWeekday: null, busiestHour: null });
    });

    it('counts only real cancellations, keeping rejected/expired requests out of the figure', async () => {
      stubDashboard({});
      await service.getDashboardSummary('salon-1', FROM, TO);

      const bookingSql: string = dataSourceQuery.mock.calls.find((c: unknown[]) => (c[0] as string).includes('no_show_count'))![0];
      expect(bookingSql).toContain("COUNT(*) FILTER (WHERE status IN ('cancelled_by_user', 'cancelled_by_salon'))");
      expect(bookingSql).not.toContain('rejected_by_salon');
    });

    it('extracts the busiest weekday/hour in Tehran local time, not UTC', async () => {
      stubDashboard({}, {}, { weekday: [{ bucket: 3 }], hour: [{ bucket: 18 }] });

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result).toMatchObject({ busiestWeekday: 3, busiestHour: 18 });
      const hourSql: string = dataSourceQuery.mock.calls.find((c: unknown[]) => (c[0] as string).includes('EXTRACT(HOUR'))![0];
      // A bare EXTRACT would read the timestamptz in UTC -- 3.5 hours off, which for the
      // half-hour part of the offset gets the reported HOUR wrong, not just shifted.
      expect(hourSql).toContain("AT TIME ZONE 'Asia/Tehran'");
    });

    it('windows the busiest-time queries on starts_at, since the question is when customers are in the chair', async () => {
      stubDashboard({});
      await service.getDashboardSummary('salon-1', FROM, TO);

      const dowSql: string = dataSourceQuery.mock.calls.find((c: unknown[]) => (c[0] as string).includes('EXTRACT(DOW'))![0];
      expect(dowSql).toContain('b.starts_at >= $2 AND b.starts_at < $3');
    });

    it('maps the top services and workers, coercing raw string aggregates', async () => {
      stubDashboard(
        {},
        {},
        {
          topServices: [{ service_id: 's1', name: 'کوتاهی مو', bookings_count: '9', gross_value: '2700000' }],
          topWorkers: [{ worker_id: 'w1', name: 'مریم', bookings_count: '6' }],
        },
      );

      const result = await service.getDashboardSummary('salon-1', FROM, TO);

      expect(result.topServices).toEqual([{ serviceId: 's1', name: 'کوتاهی مو', bookingsCount: 9, grossValue: 2_700_000 }]);
      expect(result.topWorkers).toEqual([{ workerId: 'w1', name: 'مریم', bookingsCount: 6 }]);
    });

    it('scopes every dashboard query to the caller salon', async () => {
      stubDashboard({});
      await service.getDashboardSummary('salon-7', FROM, TO);

      for (const [sql, params] of dataSourceQuery.mock.calls) {
        expect(sql).toContain('salon_id = $1');
        expect(params[0]).toBe('salon-7');
      }
    });
  });
});
