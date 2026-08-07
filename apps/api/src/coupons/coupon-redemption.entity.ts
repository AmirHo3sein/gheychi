import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

/**
 * One row per successful redemption. UNIQUE(coupon_id, user_id) at the DB level
 * (see the migration) is what actually enforces "one redemption per user per code"
 * under concurrency -- this entity is the audit trail on top of that guarantee.
 */
@Entity('coupon_redemptions')
export class CouponRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'coupon_id' })
  couponId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'booking_id', unique: true })
  bookingId: string;

  @Column({ name: 'discount_amount', type: 'bigint', transformer: bigintToNumber })
  discountAmount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
