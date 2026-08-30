import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 7 of the monetization initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md and
// docs/technical-overview/34-subscription-coupons-and-billing.md. Billing stays
// architecture-only per the owner's own locked-in decision: no real Zarinpal
// subscription-charge flow exists anywhere here -- these tables just give the
// Plan -> Subscription -> BillingPeriod -> Invoice shape somewhere real to live, with an
// admin manually recording what was actually paid/comp'd outside the platform.
export class SubscriptionBilling1756200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // A genuinely separate entity from the booking `coupons` table -- coupon_redemptions.
    // booking_id is NOT NULL UNIQUE there, structurally a booking-redemption object that a
    // subscription-period redemption doesn't fit without abusing that constraint (Phase-A
    // discovery finding). Percent-only, unlike the booking coupon's percent-or-fixed shape --
    // there is no equivalent "provider issues their own subscription coupon" concept, so this
    // stays deliberately simpler.
    await q.query(`
      CREATE TABLE subscription_coupons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(30) NOT NULL UNIQUE,
        discount_percent int NOT NULL,
        expires_at timestamptz NULL,
        max_redemptions int NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT subscription_coupons_discount_chk CHECK (discount_percent BETWEEN 1 AND 100)
      )
    `);

    await q.query(`
      CREATE TABLE subscription_billing_periods (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        plan_id uuid NOT NULL REFERENCES plans(id),
        period_start timestamptz NOT NULL,
        period_end timestamptz NOT NULL,
        base_amount_toman bigint NOT NULL,
        discount_percent int NULL,
        amount_toman bigint NOT NULL,
        coupon_id uuid NULL REFERENCES subscription_coupons(id),
        status varchar(20) NOT NULL DEFAULT 'pending',
        resolved_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT subscription_billing_periods_status_chk CHECK (status IN ('pending', 'paid', 'comped', 'void')),
        CONSTRAINT subscription_billing_periods_period_chk CHECK (period_end > period_start)
      )
    `);
    await q.query(`CREATE INDEX subscription_billing_periods_salon_idx ON subscription_billing_periods (salon_id, period_start DESC)`);

    // UNIQUE(coupon_id, salon_id) -- one redemption per salon per subscription coupon, the
    // same "one redemption per redeeming identity" convention the booking coupon system
    // uses (there: per user; here: per salon, since salons are what hold subscriptions).
    await q.query(`
      CREATE TABLE subscription_coupon_redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coupon_id uuid NOT NULL REFERENCES subscription_coupons(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        billing_period_id uuid NOT NULL REFERENCES subscription_billing_periods(id),
        redeemed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (coupon_id, salon_id)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE subscription_coupon_redemptions`);
    await q.query(`DROP TABLE subscription_billing_periods`);
    await q.query(`DROP TABLE subscription_coupons`);
  }
}
