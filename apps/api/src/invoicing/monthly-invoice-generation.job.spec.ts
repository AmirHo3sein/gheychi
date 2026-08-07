import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { MonthlyInvoiceGenerationJob } from './monthly-invoice-generation.job';

// Safely in the past relative to any real "now" this suite runs under -- a fully
// closed Jalali month with no ambiguity about system clock skew.
const CLOSED_MONTH_ROW_CREATED_AT = new Date('2020-01-15T10:00:00.000Z');

function unlinkedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ft-1',
    salon_id: 'salon-1',
    created_at: CLOSED_MONTH_ROW_CREATED_AT,
    gross_amount: '40000',
    commission_amount: '4000',
    net_amount: '36000',
    ...overrides,
  };
}

describe('MonthlyInvoiceGenerationJob', () => {
  let job: MonthlyInvoiceGenerationJob;
  let dataSourceQuery: jest.Mock;
  let dataSourceTransaction: jest.Mock;
  let alertsRaise: jest.Mock;

  beforeEach(async () => {
    dataSourceQuery = jest.fn();
    dataSourceTransaction = jest.fn();
    alertsRaise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MonthlyInvoiceGenerationJob,
        { provide: DataSource, useValue: { query: dataSourceQuery, transaction: dataSourceTransaction } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
        { provide: AlertsService, useValue: { raise: alertsRaise } },
      ],
    }).compile();

    job = moduleRef.get(MonthlyInvoiceGenerationJob);
  });

  // Standard em.query mock: routes by SQL shape, same three statements the job issues
  // per group (invoice upsert, item insert, totals recompute).
  function stubTransaction(opts: { itemInserted: boolean } = { itemInserted: true }) {
    dataSourceTransaction.mockImplementation(async (cb: (em: unknown) => unknown) => {
      const emQuery = jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-1' }];
        if (sql.includes('INSERT INTO invoice_items')) return opts.itemInserted ? [{ id: 'item-1' }] : [];
        if (sql.includes('UPDATE invoices SET')) return [];
        throw new Error(`unexpected SQL in test: ${sql}`);
      });
      return cb({ query: emQuery });
    });
  }

  it('does nothing when there are no unlinked financial_transactions rows', async () => {
    dataSourceQuery.mockResolvedValue([]);

    const result = await job.run();

    expect(result).toEqual({ invoicesTouched: 0, itemsCreated: 0 });
    expect(dataSourceTransaction).not.toHaveBeenCalled();
  });

  it('skips a row whose Jalali month has not fully closed yet (the current month)', async () => {
    dataSourceQuery.mockResolvedValue([unlinkedRow({ created_at: new Date() })]);

    const result = await job.run();

    expect(result).toEqual({ invoicesTouched: 0, itemsCreated: 0 });
    expect(dataSourceTransaction).not.toHaveBeenCalled();
  });

  it('generates an invoice and one item for a single closed-month row', async () => {
    dataSourceQuery.mockResolvedValue([unlinkedRow()]);
    stubTransaction();

    const result = await job.run();

    expect(result).toEqual({ invoicesTouched: 1, itemsCreated: 1 });
    expect(dataSourceTransaction).toHaveBeenCalledTimes(1);
  });

  it('groups multiple rows for the same salon+month into ONE invoice with multiple items', async () => {
    dataSourceQuery.mockResolvedValue([
      unlinkedRow({ id: 'ft-1' }),
      unlinkedRow({ id: 'ft-2' }),
      unlinkedRow({ id: 'ft-3' }),
    ]);
    stubTransaction();

    const result = await job.run();

    expect(dataSourceTransaction).toHaveBeenCalledTimes(1); // one group -> one transaction
    expect(result).toEqual({ invoicesTouched: 1, itemsCreated: 3 });
  });

  it('runs a separate transaction per distinct salon', async () => {
    dataSourceQuery.mockResolvedValue([
      unlinkedRow({ id: 'ft-1', salon_id: 'salon-1' }),
      unlinkedRow({ id: 'ft-2', salon_id: 'salon-2' }),
    ]);
    stubTransaction();

    const result = await job.run();

    expect(dataSourceTransaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ invoicesTouched: 2, itemsCreated: 2 });
  });

  it('does not count itemsCreated when the item insert conflicts (already invoiced by a prior run)', async () => {
    dataSourceQuery.mockResolvedValue([unlinkedRow()]);
    stubTransaction({ itemInserted: false });

    const result = await job.run();

    // The invoice upsert itself still "touches" the invoice (recomputing totals), but
    // nothing NEW was actually created.
    expect(result).toEqual({ invoicesTouched: 1, itemsCreated: 0 });
  });

  it("skips a Jalali-month group that straddles the current (still-open) month, leaving it for a later run", async () => {
    dataSourceQuery.mockResolvedValue([unlinkedRow({ created_at: new Date() }), unlinkedRow({ id: 'ft-2' })]);
    stubTransaction();

    const result = await job.run();

    // Only the closed-month row's group is processed.
    expect(dataSourceTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ invoicesTouched: 1, itemsCreated: 1 });
  });

  it("does not let one group's failure stop the others, and excludes it from the counts", async () => {
    dataSourceQuery.mockResolvedValue([
      unlinkedRow({ id: 'ft-1', salon_id: 'salon-1' }),
      unlinkedRow({ id: 'ft-2', salon_id: 'salon-2' }),
    ]);
    let call = 0;
    dataSourceTransaction.mockImplementation(async (cb: (em: unknown) => unknown) => {
      call++;
      if (call === 1) throw new Error('transient db error');
      const emQuery = jest.fn(async (sql: string) => {
        if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-2' }];
        if (sql.includes('INSERT INTO invoice_items')) return [{ id: 'item-2' }];
        return [];
      });
      return cb({ query: emQuery });
    });

    const result = await job.run();

    expect(result).toEqual({ invoicesTouched: 1, itemsCreated: 1 });
    // The failed group (salon-1) still pages an operator -- a silently understated
    // invoice is money-adjacent even though tomorrow's rerun will self-heal it.
    expect(alertsRaise).toHaveBeenCalledTimes(1);
    expect(alertsRaise).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining('salon-1'), severity: 'warning' }),
    );
  });

  it('passes the raw bigint-as-string amounts straight through to the invoice_items insert', async () => {
    dataSourceQuery.mockResolvedValue([unlinkedRow({ gross_amount: '999999', commission_amount: '99999', net_amount: '900000' })]);
    const calls: unknown[][] = [];
    dataSourceTransaction.mockImplementation(async (cb: (em: unknown) => unknown) => {
      const emQuery = jest.fn(async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        if (sql.includes('INSERT INTO invoices')) return [{ id: 'inv-1' }];
        if (sql.includes('INSERT INTO invoice_items')) return [{ id: 'item-1' }];
        return [];
      });
      return cb({ query: emQuery });
    });

    await job.run();

    const itemInsertCall = calls.find(([sql]) => (sql as string).includes('INSERT INTO invoice_items'));
    expect(itemInsertCall?.[1]).toEqual(['inv-1', 'ft-1', '999999', '99999', '900000']);
  });
});
