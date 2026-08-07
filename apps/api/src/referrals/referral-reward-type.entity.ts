import { Column, Entity, PrimaryColumn } from 'typeorm';
import { nullableNumericToNumber, numericToNumber } from '../common/numeric-transformers';

export type ReferralType = 'user' | 'salon_owner' | 'worker';
export type RewardKind = 'wallet_credit' | 'percent_discount' | 'fixed_discount' | 'cashback' | 'loyalty_points';
export type QualifyingEvent = 'first_completed_booking' | 'first_paid_booking';

// Exactly 3 fixed rows (user/salon_owner/worker), seeded enabled=false (R12).
// PATCH-only via the admin endpoint -- never inserted/deleted at runtime.
@Entity('referral_reward_types')
export class ReferralRewardType {
  @PrimaryColumn({ name: 'referral_type', type: 'varchar', length: 20 })
  referralType: ReferralType;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ name: 'referrer_reward_kind', type: 'varchar', length: 20 })
  referrerRewardKind: RewardKind;

  @Column({
    name: 'referrer_reward_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericToNumber,
  })
  referrerRewardValue: number;

  @Column({
    name: 'referrer_reward_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: nullableNumericToNumber,
  })
  referrerRewardMax: number | null;

  @Column({ name: 'referred_reward_kind', type: 'varchar', length: 20 })
  referredRewardKind: RewardKind;

  @Column({
    name: 'referred_reward_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: numericToNumber,
  })
  referredRewardValue: number;

  @Column({
    name: 'referred_reward_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: nullableNumericToNumber,
  })
  referredRewardMax: number | null;

  @Column({ name: 'qualifying_event', type: 'varchar', length: 30, default: 'first_paid_booking' })
  qualifyingEvent: QualifyingEvent;

  @Column({ name: 'grant_holdback_hours', type: 'int', default: 72 })
  grantHoldbackHours: number;

  @Column({ name: 'expiration_days', type: 'int', nullable: true })
  expirationDays: number | null;

  @Column({ name: 'max_referrals_per_referrer', type: 'int', nullable: true })
  maxReferralsPerReferrer: number | null;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
