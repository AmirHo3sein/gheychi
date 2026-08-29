import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 2 of the monetization/subscription platform initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md. Introduces the
// Plan/SalonSubscription backbone every later phase (entitlement enforcement, CRM, SMS
// quota, custom-handle access) reads from. Seeds exactly one FREE plan and backfills every
// existing salon onto it, so no salon is ever left without a resolvable subscription --
// the monetization spec's migration-safety requirement (#23).
export class SubscriptionsAndPlans1755600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(40) NOT NULL UNIQUE,
        name varchar(80) NOT NULL,
        description text NULL,
        monthly_price_toman int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        is_default boolean NOT NULL DEFAULT false,
        sort_order int NOT NULL DEFAULT 0,
        entitlements jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT plans_price_chk CHECK (monthly_price_toman >= 0)
      )
    `);
    // Exactly one plan may be default at a time -- indexing a constant expression under a
    // WHERE filter is the standard Postgres idiom for "at most one row where <condition>"
    // (every qualifying row indexes to the same value, so a second one collides).
    await q.query(`
      CREATE UNIQUE INDEX plans_is_default_uidx ON plans ((true)) WHERE is_default = true
    `);

    await q.query(`
      CREATE TABLE salon_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL UNIQUE REFERENCES salons(id),
        plan_id uuid NOT NULL REFERENCES plans(id),
        status varchar(20) NOT NULL DEFAULT 'active',
        started_at timestamptz NOT NULL DEFAULT now(),
        canceled_at timestamptz NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT salon_subscriptions_status_chk CHECK (status IN ('active', 'canceled'))
      )
    `);
    await q.query(`CREATE INDEX salon_subscriptions_plan_idx ON salon_subscriptions (plan_id)`);

    const [{ id: freePlanId }] = await q.query(`
      INSERT INTO plans (key, name, description, monthly_price_toman, is_active, is_default, sort_order, entitlements)
      VALUES ('free', 'رایگان', 'پلن پیش‌فرض هر سالن جدید', 0, true, true, 0, '{}')
      RETURNING id
    `);
    await q.query(
      `
      INSERT INTO salon_subscriptions (salon_id, plan_id, status, started_at)
      SELECT id, $1, 'active', now() FROM salons
    `,
      [freePlanId],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_subscriptions`);
    await q.query(`DROP TABLE plans`);
  }
}
