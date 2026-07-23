import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { WalletCurrency } from './wallet-balance.entity';

// referral_reward/referral_reversal are listed per the DB CHECK constraint even
// though nothing produces them yet in this slice -- referrals don't exist until
// slices 3-5 (see docs/superpowers/specs/2026-07-21-referral-and-rating-system-design.md
// section 2, Slice 2). This slice only ever writes 'admin_adjustment' rows.
export type WalletTransactionType = 'referral_reward' | 'referral_reversal' | 'admin_adjustment';

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
