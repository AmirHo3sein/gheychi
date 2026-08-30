import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

export type BillingPeriodStatus = 'pending' | 'paid' | 'comped' | 'void';

// Architecture-only, per the owner's own locked-in decision (Plan -> Subscription ->
// BillingPeriod -> Invoice shape, admin manually marks paid/comp'd -- no real Zarinpal
// subscription-charge flow). Rows are admin-created only, never a cron -- see this module's
// own doc comment for why. Phase 7 of the monetization initiative
// (docs/technical-overview/34-subscription-coupons-and-billing.md).
@Entity('subscription_billing_periods')
export class SubscriptionBillingPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  // Snapshot of which plan was billed -- like commission_percent/financial_transactions,
  // never re-derived from the salon's CURRENT plan after the fact.
  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  // The plan's monthlyPriceToman at creation time, frozen -- a later price change on the
  // plan itself never retroactively alters an already-created period, same "frozen at
  // accrual" precedent commission/financial_transactions already established.
  @Column({ name: 'base_amount_toman', type: 'bigint', transformer: bigintToNumber })
  baseAmountToman: number;

  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number | null;

  @Column({ name: 'amount_toman', type: 'bigint', transformer: bigintToNumber })
  amountToman: number;

  @Column({ name: 'coupon_id', type: 'uuid', nullable: true })
  couponId: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: BillingPeriodStatus;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
