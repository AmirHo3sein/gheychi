import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

export type PaymentStatus = 'initiated' | 'paid' | 'refund_pending' | 'refunded' | 'failed';

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

  // The refund's in-flight claim, CAS'd from NULL (or from a stale value) by
  // attemptRefund immediately BEFORE it calls the gateway, so that of two concurrent
  // attempts -- the inline one from cancel() and RefundRetryJob's, or two API replicas --
  // exactly one ever reaches Zarinpal. Cleared on every failure path so the retry job can
  // pick the payment up again on its next tick; deliberately a timestamp rather than a
  // boolean so a claim orphaned by a process crash mid-gateway-call self-heals after
  // REFUND_CLAIM_TTL_MS instead of stranding the refund forever.
  @Column({ name: 'refund_claimed_at', type: 'timestamptz', nullable: true })
  refundClaimedAt: Date | null;

  // Zarinpal's refund reference (refund.json ref_id). Non-null iff status is 'refunded'
  // via the real gateway (mock writes MOCKREFUND-* values).
  @Column({ name: 'refund_ref_id', type: 'varchar', nullable: true })
  refundRefId: string | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'varchar', default: 'initiated' })
  status: PaymentStatus;

  // Set at the exact moment status flips to 'paid' (handleCallback's 'captured' capture
  // outcome, and PaymentReconciliationJob's success branch). Referral reward granting's
  // R7 hold-back window ("first_paid_booking" grants require the payment to have been
  // paid for at least grant_holdback_hours) is measured from this timestamp, not
  // createdAt -- a payment can sit 'initiated' for a while before a late callback or
  // reconciliation actually confirms it.
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
