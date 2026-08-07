import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

/**
 * One row per financial_transactions row an invoice pulled in. The UNIQUE constraint on
 * financialTransactionId (see the migration) -- not application logic -- is what makes
 * "never double-invoice the same commission row" a DB-level guarantee: a rerun's second
 * insert attempt for the same transaction is a harmless ON CONFLICT DO NOTHING.
 *
 * gross/commission/netAmount are copied from the source ledger row at invoicing time,
 * deliberately redundant so this row (and the invoice it rolls into) is legible without
 * a join, and immune to a hypothetical future ledger edit (which shouldn't happen -- the
 * ledger is append-only -- but this makes the invoice's own numbers self-contained
 * regardless).
 */
@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @Column({ name: 'financial_transaction_id', unique: true })
  financialTransactionId: string;

  @Column({ name: 'gross_amount', type: 'bigint', transformer: bigintToNumber })
  grossAmount: number;

  @Column({ name: 'commission_amount', type: 'bigint', transformer: bigintToNumber })
  commissionAmount: number;

  @Column({ name: 'net_amount', type: 'bigint', transformer: bigintToNumber })
  netAmount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
