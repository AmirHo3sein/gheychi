import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { isJalaliMonthClosed, jalaliMonthBounds, jalaliMonthOf, JalaliMonth } from './jalali-period.util';

interface UnlinkedTransactionRow {
  id: string;
  salon_id: string;
  created_at: Date;
  gross_amount: string;
  commission_amount: string;
  net_amount: string;
}

/**
 * Generates/updates one Invoice per (salon, Jalali month) from financial_transactions
 * rows that don't have an invoice_items row yet. Runs DAILY (not just on the 1st) so a
 * booking completed late, or a skipped run, is still swept in whenever this next fires.
 *
 * Idempotency is a DB-level guarantee, not application discipline: UNIQUE(salon_id,
 * jalali_year, jalali_month) on invoices and UNIQUE(financial_transaction_id) on
 * invoice_items make a rerun's inserts harmless ON CONFLICT no-ops.
 */
@Injectable()
export class MonthlyInvoiceGenerationJob {
  private readonly logger = new Logger(MonthlyInvoiceGenerationJob.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron('0 3 * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<{ invoicesTouched: number; itemsCreated: number }> {
    const now = new Date();

    const rows = await this.dataSource.query<UnlinkedTransactionRow[]>(`
      SELECT ft.id, ft.salon_id, ft.created_at, ft.gross_amount, ft.commission_amount, ft.net_amount
      FROM financial_transactions ft
      LEFT JOIN invoice_items ii ON ii.financial_transaction_id = ft.id
      WHERE ii.id IS NULL
    `);

    // Grouped in JS, not SQL -- there is no Jalali-calendar function in Postgres, and
    // this table is small (one row per completed/no-show booking), so pulling every
    // unlinked row and bucketing here is simpler than a stored procedure for it.
    const groups = new Map<string, { salonId: string; month: JalaliMonth; rows: UnlinkedTransactionRow[] }>();
    for (const row of rows) {
      const month = jalaliMonthOf(new Date(row.created_at));
      // The still-open current month is left for a later run -- invoicing it now would
      // just mean recomputing it again (and again) every day until it actually closes.
      if (!isJalaliMonthClosed(month, now)) continue;
      const key = `${row.salon_id}:${month.year}:${month.month}`;
      const group = groups.get(key) ?? { salonId: row.salon_id, month, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    let invoicesTouched = 0;
    let itemsCreated = 0;

    for (const group of groups.values()) {
      const { periodStart, periodEnd } = jalaliMonthBounds(group.month);
      try {
        await this.dataSource.transaction(async (em) => {
          // ON CONFLICT DO UPDATE (a harmless self-set), not DO NOTHING, so RETURNING
          // always yields the row's id -- whether this run created the invoice or a
          // prior run already did.
          const [invoiceRow] = await em.query<Array<{ id: string }>>(
            `INSERT INTO invoices
               (salon_id, jalali_year, jalali_month, period_start, period_end, total_gross_amount, total_commission_amount, total_net_payable, status)
             VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 'issued')
             ON CONFLICT (salon_id, jalali_year, jalali_month) DO UPDATE SET salon_id = EXCLUDED.salon_id
             RETURNING id`,
            [group.salonId, group.month.year, group.month.month, periodStart, periodEnd],
          );
          const invoiceId = invoiceRow.id;

          for (const row of group.rows) {
            const inserted = await em.query<Array<{ id: string }>>(
              `INSERT INTO invoice_items (invoice_id, financial_transaction_id, gross_amount, commission_amount, net_amount)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (financial_transaction_id) DO NOTHING
               RETURNING id`,
              [invoiceId, row.id, row.gross_amount, row.commission_amount, row.net_amount],
            );
            if (inserted.length > 0) itemsCreated++;
          }

          // Recomputed from scratch over ALL of this invoice's items (never
          // incrementally added), so a rerun or a late-arriving item can never leave
          // these stale. A payment recorded against a since-grown total is handled
          // here too: if paid_total no longer covers the new total, status drops back
          // from 'paid' to 'partially_paid'.
          await em.query(
            `UPDATE invoices SET
               total_gross_amount = sub.g,
               total_commission_amount = sub.c,
               total_net_payable = sub.n,
               status = CASE
                 WHEN invoices.paid_total >= sub.n AND sub.n > 0 THEN 'paid'
                 WHEN invoices.paid_total > 0 THEN 'partially_paid'
                 ELSE invoices.status
               END
             FROM (
               SELECT COALESCE(SUM(gross_amount), 0) AS g, COALESCE(SUM(commission_amount), 0) AS c, COALESCE(SUM(net_amount), 0) AS n
               FROM invoice_items WHERE invoice_id = $1
             ) sub
             WHERE invoices.id = $1`,
            [invoiceId],
          );
        });
        invoicesTouched++;
      } catch (err) {
        // One salon's month failing (a transient DB error) must not block every other
        // group in this run -- log and move on. Its financial_transactions rows stay
        // unlinked and are picked up again on tomorrow's run.
        this.logger.error(
          `Failed to generate/update the ${group.month.year}/${group.month.month} invoice for salon ${group.salonId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { invoicesTouched, itemsCreated };
  }
}
