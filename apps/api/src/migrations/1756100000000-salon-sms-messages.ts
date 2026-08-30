import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 6 of the monetization initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md and
// docs/technical-overview/33-salon-sms-quota.md. Append-only log of salon-initiated customer
// SMS -- doubles as the quota-usage source of truth (COUNT of rows within the current Jalali
// month), so there's no separate mutable counter to keep in sync.
export class SalonSmsMessages1756100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE salon_sms_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        customer_id uuid NOT NULL REFERENCES users(id),
        phone varchar(20) NOT NULL,
        message varchar(500) NOT NULL,
        sent_by uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX salon_sms_messages_salon_created_idx ON salon_sms_messages (salon_id, created_at)`);

    // Every existing plan (today, only 'free') gets a real, admin-editable placeholder quota
    // instead of silently defaulting to zero -- matches this initiative's own "every plan
    // name/price/limit ships as an admin-editable placeholder" decision. The `NOT (entitlements
    // ? 'smsMonthlyQuota')` guard is defensive: at migration time every plan's entitlements is
    // still `{}`, but this keeps the statement idempotent-in-spirit if ever re-run against a
    // database where an admin already set the key by hand.
    await q.query(`
      UPDATE plans
      SET entitlements = entitlements || '{"smsMonthlyQuota": 20}'::jsonb
      WHERE NOT (entitlements ? 'smsMonthlyQuota')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_sms_messages`);
  }
}
