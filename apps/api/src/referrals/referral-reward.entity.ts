import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RewardKind } from './referral-reward-type.entity';

export type RewardBeneficiaryRole = 'referrer' | 'referred';
export type ReferralRewardStatus = 'granted' | 'reversed';

// numeric(12,2) columns -- see referral.entity.ts's identical convention comment.
const numericToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};
const nullableNumericToNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

// One row per (referral, beneficiary_role) -- UNIQUE(referral_id, beneficiary_role)
// (referral_rewards_referral_role_uidx) is the DB-enforced exactly-once backstop
// tryGrantReward relies on (spec section 7). Doubles as the payout record: exactly
// one of wallet_transaction_id (wallet_credit/cashback/loyalty_points) or coupon_id
// (percent_discount/fixed_discount, slice 5+) is set once a row exists. Slice 4 only
// ever produces wallet_transaction_id rows -- discount-kind sides are skipped
// entirely (not yet supported), so a referral can have 0, 1, or 2 of these rows
// depending on which side(s)' reward_kind is currently grantable (see
// referrals.status's 'partially_granted' state).
@Entity('referral_rewards')
export class ReferralReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'referral_id' })
  referralId: string;

  @Column({ name: 'beneficiary_user_id' })
  beneficiaryUserId: string;

  @Column({ name: 'beneficiary_role', type: 'varchar', length: 10 })
  beneficiaryRole: RewardBeneficiaryRole;

  @Column({ name: 'reward_kind', type: 'varchar', length: 20 })
  rewardKind: RewardKind;

  // Resolved & capped absolute value at grant time (reward_max applied, if set) --
  // never re-derived from referral_reward_types/referrals after the fact.
  @Column({ name: 'reward_value', type: 'numeric', precision: 12, scale: 2, transformer: numericToNumber })
  rewardValue: number;

  @Column({ name: 'wallet_transaction_id', type: 'uuid', nullable: true })
  walletTransactionId: string | null;

  @Column({ name: 'coupon_id', type: 'uuid', nullable: true })
  couponId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'granted' })
  status: ReferralRewardStatus;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversal_reason', type: 'text', nullable: true })
  reversalReason: string | null;

  // Set only when a reversal's clawback debit was capped short of the full reward
  // value (R11 -- wallet balance never goes negative). Non-null shortfall means the
  // platform is genuinely short that amount; ReferralsService.reverseIfNeeded pages
  // AlertsService at 'critical' when this happens.
  @Column({
    name: 'reversal_shortfall_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: nullableNumericToNumber,
  })
  reversalShortfallAmount: number | null;
}
