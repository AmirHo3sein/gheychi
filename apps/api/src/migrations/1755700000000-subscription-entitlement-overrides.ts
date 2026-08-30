import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 3 of the monetization initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md. The three-way split
// the owner's prompt called for: GLOBAL feature flag (Phase 1) vs PLAN entitlement (Phase 2)
// vs this SALON-SPECIFIC admin override. Null by default -- every existing/new subscription
// keeps inheriting its plan's entitlements verbatim until an admin explicitly overrides one.
export class SubscriptionEntitlementOverrides1755700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_subscriptions ADD COLUMN entitlement_overrides jsonb NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_subscriptions DROP COLUMN entitlement_overrides`);
  }
}
