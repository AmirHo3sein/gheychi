import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type SubscriptionStatus = 'active' | 'canceled';

/**
 * A salon's current plan assignment. One row per salon (salon_id is UNIQUE, mirroring
 * salon.ownerId's own one-salon-per-owner simplicity) -- this is deliberately a single
 * mutable "current state" row, not an append-only history, since there is no billing engine
 * yet to make repeated period rows meaningful (that's explicitly deferred to the
 * billing-architecture phase, see the monetization spec). `status: 'canceled'` still has
 * real meaning without billing: it means the salon reverted to the platform default plan
 * (see SubscriptionsService.getEntitlements) -- an admin-driven decision, not an automatic
 * expiry.
 */
@Entity('salon_subscriptions')
export class SalonSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id', unique: true })
  salonId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ default: 'active' })
  status: SubscriptionStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
