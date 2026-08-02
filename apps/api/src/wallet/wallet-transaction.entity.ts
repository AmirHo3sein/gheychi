import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { WalletCurrency } from './wallet-balance.entity';

// booking_spend/booking_spend_reversal are written by BookingsService.createHold
// (applying a customer's wallet balance to a deposit) and releaseBookingHold
// (giving it back if the hold dies before payment captures) -- see
// booking-hold-release.util.ts for why release, not refund-time reversal, is the
// only path that ever needs to undo a booking_spend row.
export type WalletTransactionType =
  | 'referral_reward'
  | 'referral_reversal'
  | 'admin_adjustment'
  | 'booking_spend'
  | 'booking_spend_reversal';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 10, default: 'toman' })
  currency: WalletCurrency;

  // Signed: positive = credit, negative = debit.
  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  // Snapshot of wallet_balances.balance immediately after this row was applied,
  // computed inside the same row-locked transaction -- never recomputed later.
  @Column({ name: 'balance_after', type: 'bigint', transformer: bigintToNumber })
  balanceAfter: number;

  @Column({ type: 'varchar', length: 30 })
  type: WalletTransactionType;

  // Polymorphic, deliberately not FK-constrained (points at referral_rewards.id
  // once slice 4 ships, may point elsewhere later) -- matches this codebase's
  // existing manual-FK-column convention for a genuinely polymorphic case.
  @Column({ name: 'reference_type', type: 'varchar', length: 30, nullable: true })
  referenceType: string | null;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  // Required app-side for admin_adjustment (not DB-enforced -- see AdjustWalletDto).
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
