import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { nullableNumericToNumber, numericToNumber } from '../common/numeric-transformers';
import { QualifyingEvent, ReferralType, RewardKind } from './referral-reward-type.entity';

// 'partially_granted': one beneficiary side (referrer/referred) has a referral_rewards
// row, the other doesn't yet. As of Slice 6 all five reward kinds are grantable, so this
// is now defense-in-depth (a future reward kind added without matching grant logic, or
// re-visiting a referral partially granted by an older build) rather than the expected
// steady-state -- see ReferralsService.tryGrantReward's status-transition logic.
export type ReferralStatus = 'awaiting_qualifying_event' | 'partially_granted' | 'reward_granted' | 'expired' | 'cancelled';

// Reward terms, qualifying event, and grant hold-back are all SNAPSHOTTED from
// referral_reward_types at redemption time (R5) and never re-read live again -- an
// admin changing config only affects referrals created after the change.
// 'reward_granted'/'partially_granted' are produced by ReferralsService.tryGrantReward;
// 'expired' is produced by ReferralExpiryJob's hourly sweep.
@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'referral_code_id' })
  referralCodeId: string;

  @Column({ name: 'referrer_user_id' })
  referrerUserId: string;

  @Column({ name: 'referred_user_id', unique: true })
  referredUserId: string;

  @Column({ name: 'referral_type', type: 'varchar', length: 20 })
  referralType: ReferralType;

  // salon_owner/worker types only -- null for user-type referrals.
  @Column({ name: 'salon_id', type: 'uuid', nullable: true })
  salonId: string | null;

  @Column({ name: 'referrer_reward_kind', type: 'varchar', length: 20 })
  referrerRewardKind: RewardKind;

  @Column({ name: 'referrer_reward_value', type: 'numeric', precision: 12, scale: 2, transformer: numericToNumber })
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

  @Column({ name: 'referred_reward_value', type: 'numeric', precision: 12, scale: 2, transformer: numericToNumber })
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

  @Column({ name: 'qualifying_event', type: 'varchar', length: 30 })
  qualifyingEvent: QualifyingEvent;

  @Column({ name: 'grant_holdback_hours', type: 'int' })
  grantHoldbackHours: number;

  @Column({ type: 'varchar', length: 30, default: 'awaiting_qualifying_event' })
  status: ReferralStatus;

  @Column({ name: 'qualifying_booking_id', type: 'uuid', nullable: true })
  qualifyingBookingId: string | null;

  @Column({ name: 'reward_granted_at', type: 'timestamptz', nullable: true })
  rewardGrantedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'cancelled_reason', type: 'text', nullable: true })
  cancelledReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
