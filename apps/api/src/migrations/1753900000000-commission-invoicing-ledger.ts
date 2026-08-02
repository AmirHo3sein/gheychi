import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommissionInvoicingLedger1753900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Append-only commission ledger -- one row per booking completed/no-show event.
    // commission_rate/commission_amount are frozen at write time (see
    // FinancialTransaction's own doc comment); the CHECK below is the DB-level
    // invariant that a row's three money columns always reconcile.
    await q.query(`
      CREATE TABLE financial_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        type varchar(30) NOT NULL CHECK (type IN ('commission_accrued', 'commission_reversed')),
        gross_amount bigint NOT NULL CHECK (gross_amount >= 0),
        commission_rate numeric(5,2) NOT NULL CHECK (commission_rate >= 0),
        commission_amount bigint NOT NULL CHECK (commission_amount >= 0),
        net_amount bigint NOT NULL CHECK (net_amount >= 0),
        correction_of_id uuid NULL REFERENCES financial_transactions(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (commission_amount + net_amount = gross_amount)
      )`);
    await q.query(`CREATE INDEX financial_transactions_salon_created_idx ON financial_transactions(salon_id, created_at)`);
    await q.query(`CREATE INDEX financial_transactions_booking_idx ON financial_transactions(booking_id)`);

    // The one mutable table -- a derived aggregate over financial_transactions/
    // invoice_items, recomputed (never incrementally adjusted) by
    // MonthlyInvoiceGenerationJob. UNIQUE(salon_id, jalali_year, jalali_month) is the
    // actual "never double-invoice a month" guarantee.
    await q.query(`
      CREATE TABLE invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        jalali_year int NOT NULL,
        jalali_month int NOT NULL CHECK (jalali_month BETWEEN 1 AND 12),
        period_start timestamptz NOT NULL,
        period_end timestamptz NOT NULL,
        total_gross_amount bigint NOT NULL DEFAULT 0,
        total_commission_amount bigint NOT NULL DEFAULT 0,
        total_net_payable bigint NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partially_paid', 'paid', 'void')),
        paid_total bigint NOT NULL DEFAULT 0,
        issued_at timestamptz NOT NULL DEFAULT now(),
        paid_at timestamptz NULL,
        -- Reserved seam for a future automated-payout Settlement table; unused and
        -- deliberately un-FK'd today (see Invoice entity's own doc comment).
        settlement_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (salon_id, jalali_year, jalali_month)
      )`);
    await q.query(`CREATE INDEX invoices_salon_idx ON invoices(salon_id)`);

    // UNIQUE(financial_transaction_id) is the DB-level "never double-invoice this
    // commission row" guarantee -- a rerun's second insert attempt is a harmless
    // ON CONFLICT DO NOTHING.
    await q.query(`
      CREATE TABLE invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        financial_transaction_id uuid NOT NULL UNIQUE REFERENCES financial_transactions(id),
        gross_amount bigint NOT NULL,
        commission_amount bigint NOT NULL,
        net_amount bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX invoice_items_invoice_idx ON invoice_items(invoice_id)`);

    // Named InvoicePayment (table invoice_payments), not Payment, to avoid colliding
    // with the existing booking `payments` table -- see the entity's own doc comment.
    await q.query(`
      CREATE TABLE invoice_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES invoices(id),
        amount bigint NOT NULL CHECK (amount > 0),
        method varchar(20) NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'other', 'automatic_payout', 'wallet_credit')),
        reference_number varchar(100) NULL,
        note text NULL,
        recorded_by_admin_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX invoice_payments_invoice_idx ON invoice_payments(invoice_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE invoice_payments`);
    await q.query(`DROP TABLE invoice_items`);
    await q.query(`DROP TABLE invoices`);
    await q.query(`DROP TABLE financial_transactions`);
  }
}
