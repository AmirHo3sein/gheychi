import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// bank_transfer/cash/other are the only methods anything writes today (admin manually
// recording a settlement). automatic_payout/wallet_credit are listed per the DB CHECK
// constraint as reserved values for when automated payout ships -- a future job would
// become a second *writer* of this same table (inserting its own rows), not a schema
// change.
export type InvoicePaymentMethod = 'bank_transfer' | 'cash' | 'other' | 'automatic_payout' | 'wallet_credit';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

/**
 * Named InvoicePayment, not Payment, to avoid colliding with the existing booking
 * `payments` table (a customer's Zarinpal deposit) -- a completely different kind of
 * money event. Multiple rows per invoice are how partial payments are modeled; nothing
 * here ever mutates financial_transactions or invoice_items.
 */
@Entity('invoice_payments')
export class InvoicePayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id' })
  invoiceId: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  method: InvoicePaymentMethod;

  @Column({ name: 'reference_number', type: 'varchar', length: 100, nullable: true })
  referenceNumber: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'recorded_by_admin_id' })
  recordedByAdminId: string;

  // Doubles as "paid at" for this installment -- there is no separate updatedAt, this
  // row is never modified after insert.
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
