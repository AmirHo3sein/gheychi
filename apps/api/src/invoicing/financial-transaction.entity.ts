import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

// commission_reversed exists only for a manual admin correction of an already-written
// row (see InvoicingService.correctCommission) -- normal operation only ever writes
// commission_accrued, once per booking, from BookingsService.updateStatus.
export type FinancialTransactionType = 'commission_accrued' | 'commission_reversed';

/**
 * Append-only commission ledger. Rows are never UPDATEd -- a correction is a new
 * offsetting row referencing the original via correctionOfId, same discipline as
 * wallet_transactions.
 *
 * grossAmount is the booking's DEPOSIT (booking.depositAmount at the moment this row is
 * written), never the full service price: the deposit is the only money the platform
 * ever captures online, so it's the only money a commission can honestly be computed
 * against -- the remaining ~80% is cash paid customer-to-salon, entirely invisible to
 * this system.
 *
 * commissionPercent/commissionAmount are FROZEN at write time (read once from
 * PlatformConfigService.getCommissionPercent() inside the same transaction as the
 * booking-status write that triggers this row) and never recomputed -- a later change to
 * the platform's commission_percent config can never retroactively alter a past booking's
 * commission. This is the second price-relevant snapshot on the money path, after
 * booking.priceSnapshot/depositAmount taken at booking-creation time.
 */
@Entity('financial_transactions')
export class FinancialTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  // Denormalized from the booking for cheap per-salon aggregation (monthly invoice
  // generation) without a join back to bookings.
  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'varchar', length: 30 })
  type: FinancialTransactionType;

  @Column({ name: 'gross_amount', type: 'bigint', transformer: bigintToNumber })
  grossAmount: number;

  // numeric(5,2) -- TypeORM returns Postgres numeric columns as strings by default
  // (matches Worker.ratingAvg/Salon.ratingAvg's exact handling).
  @Column({ name: 'commission_rate', type: 'numeric', precision: 5, scale: 2 })
  commissionPercent: string;

  @Column({ name: 'commission_amount', type: 'bigint', transformer: bigintToNumber })
  commissionAmount: number;

  @Column({ name: 'net_amount', type: 'bigint', transformer: bigintToNumber })
  netAmount: number;

  // Self-reference for a correction row; null on every normal row.
  @Column({ name: 'correction_of_id', type: 'uuid', nullable: true })
  correctionOfId: string | null;

  // The authoritative "commission earned" timestamp -- monthly invoice generation
  // buckets a row by this, never by the booking's own startsAt/endsAt (appointment
  // time is irrelevant to when the commission was actually earned).
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
