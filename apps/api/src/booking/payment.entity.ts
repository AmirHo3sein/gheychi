import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PaymentStatus = 'initiated' | 'paid' | 'refund_pending' | 'refunded' | 'failed';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', unique: true })
  bookingId: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'varchar', default: 'zarinpal' })
  gateway: string;

  @Column({ type: 'varchar', nullable: true })
  authority: string | null;

  @Column({ name: 'ref_id', type: 'varchar', nullable: true })
  refId: string | null;

  // Set when a producer (cancel, reconciliation) marks the payment refund_pending.
  // The table has no updated_at; the retry job's grace period and its 24h
  // escalation both key off this.
  @Column({ name: 'refund_requested_at', type: 'timestamptz', nullable: true })
  refundRequestedAt: Date | null;

  // Zarinpal's refund reference (refund.json ref_id). Non-null iff status is 'refunded'
  // via the real gateway (mock writes MOCKREFUND-* values).
  @Column({ name: 'refund_ref_id', type: 'varchar', nullable: true })
  refundRefId: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'varchar', default: 'initiated' })
  status: PaymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
