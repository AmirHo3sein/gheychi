import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { nullableBigintToNumber } from '../common/numeric-transformers';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Always stored uppercase+trimmed by CouponsService -- never trust a raw value here.
  @Column()
  code: string;

  // NULL = platform-wide (admin-created); non-null = scoped to that salon
  // (provider-created).
  @Column({ name: 'salon_id', type: 'uuid', nullable: true })
  salonId: string | null;

  // Slice 6: exactly one of discountPercent/discountFixedAmount is ever set, never
  // both, never neither -- enforced by the DB's coupons_discount_shape_chk CHECK
  // constraint. Every coupon before Slice 6 (and every one created through the
  // manual admin/provider CreateCouponDto today, which is still percent-only) has
  // discountPercent set and discountFixedAmount null; only a referral-issued
  // fixed_discount reward (ReferralsService.issueReferralCoupon) ever populates the
  // fixed side instead.
  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number | null;

  // Fixed toman amount off the price, e.g. 50000 = "50,000 تومان تخفیف". Mutually
  // exclusive with discountPercent -- see discount_util.ts's resolveBestPrice for how
  // the two kinds are compared against each other via resulting price, not raw value.
  @Column({ name: 'discount_fixed_amount', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  discountFixedAmount: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'max_redemptions', type: 'int', nullable: true })
  maxRedemptions: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // NULL = unrestricted (every pre-existing/manually-entered coupon, and every
  // future admin/provider-created one) -- non-null = usable only by that one user,
  // set exclusively by ReferralsService.tryGrantReward when issuing a percent_discount
  // referral reward as a literal coupon row (spec section 2/3, Slice 5). Enforced in
  // CouponsService.resolveAndValidate.
  @Column({ name: 'issued_to_user_id', type: 'uuid', nullable: true })
  issuedToUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
