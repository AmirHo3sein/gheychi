import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// One redemption per (coupon, salon) -- DB-unique-backstopped (see the migration). The
// redeeming identity is the SALON, not a user, since subscriptions belong to salons.
@Entity('subscription_coupon_redemptions')
export class SubscriptionCouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'coupon_id' })
  couponId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'billing_period_id' })
  billingPeriodId: string;

  @CreateDateColumn({ name: 'redeemed_at' })
  redeemedAt: Date;
}
