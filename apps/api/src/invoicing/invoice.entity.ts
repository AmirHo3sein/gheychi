import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InvoiceStatus = 'issued' | 'partially_paid' | 'paid' | 'void';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

/**
 * A monthly per-salon settlement statement -- the one mutable row in the invoicing
 * schema (a derived aggregate over financial_transactions/invoice_items, not itself a
 * money event, so recomputing its cached totals is always safe).
 *
 * Framing that matters: this is NOT the platform billing the salon. The platform holds
 * the deposits it collected on the salon's behalf; this statement says how much of that
 * it's keeping (commission) and how much it owes back (totalNetPayable). "Paid" means
 * an admin has bank-transferred totalNetPayable to the salon and is recording that --
 * the direction a naive SaaS-invoice mental model would assume is reversed here.
 */
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  // Salons and admins reconcile in Jalali months, not Gregorian -- these two plus the
  // UNIQUE(salon_id, jalali_year, jalali_month) DB constraint are what make "never
  // double-invoice the same month" a guarantee, not application discipline.
  @Column({ name: 'jalali_year', type: 'int' })
  jalaliYear: number;

  @Column({ name: 'jalali_month', type: 'int' })
  jalaliMonth: number;

  // The Jalali month's boundaries, converted to real UTC instants (same Iran-offset
  // convention as availability.util.ts) -- the actual range financial_transactions rows
  // were matched against, kept alongside the display-only jalaliYear/jalaliMonth pair.
  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  // Cached sums of this invoice's invoice_items -- recomputed (never incrementally
  // adjusted) every time MonthlyInvoiceGenerationJob touches this invoice, so a rerun
  // or a late-arriving item can never leave these stale.
  @Column({ name: 'total_gross_amount', type: 'bigint', transformer: bigintToNumber })
  totalGrossAmount: number;

  @Column({ name: 'total_commission_amount', type: 'bigint', transformer: bigintToNumber })
  totalCommissionAmount: number;

  @Column({ name: 'total_net_payable', type: 'bigint', transformer: bigintToNumber })
  totalNetPayable: number;

  @Column({ type: 'varchar', length: 20, default: 'issued' })
  status: InvoiceStatus;

  // Cached sum of this invoice's invoice_payments, updated whenever a payment is
  // recorded (or the total above is recomputed and a status re-derivation is needed).
  @Column({ name: 'paid_total', type: 'bigint', default: 0, transformer: bigintToNumber })
  paidTotal: number;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  // Reserved seam for a future automated-payout batch table (Settlement), deliberately
  // not built yet -- an empty table with no writer would just invite half-wiring. Unused
  // and un-FK'd today; a later Settlement feature attaches here without touching this
  // table's shape.
  @Column({ name: 'settlement_id', type: 'uuid', nullable: true })
  settlementId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
