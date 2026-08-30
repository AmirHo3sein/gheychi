import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// A genuinely separate entity from the booking `Coupon` -- see this module's own doc
// comment (billing.module.ts) and docs/technical-overview/34-subscription-coupons-and-billing.md.
// Percent-only, platform-wide only (no salon-issued subscription coupons).
@Entity('subscription_coupons')
export class SubscriptionCoupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Always stored uppercase+trimmed by SubscriptionCouponsService -- never trust a raw value.
  @Column()
  code: string;

  @Column({ name: 'discount_percent', type: 'int' })
  discountPercent: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'max_redemptions', type: 'int', nullable: true })
  maxRedemptions: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
