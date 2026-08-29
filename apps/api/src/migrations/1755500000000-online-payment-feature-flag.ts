import { MigrationInterface, QueryRunner } from 'typeorm';

export class OnlinePaymentFeatureFlag1755500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Seeded false, unlike every other feature flag's launch value (true): this is a new
    // global capability being introduced, not an existing behavior being made toggleable,
    // so "off" is the safe, no-behavior-change default. Every existing/new booking simply
    // takes the zero-deposit path that already exists (deposit collected in cash at the
    // salon) until an admin explicitly flips it on via PATCH /admin/feature-flags.
    await q.query(`
      INSERT INTO platform_config (key, value) VALUES
        ('feature_online_payment_enabled', 'false')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM platform_config WHERE key = 'feature_online_payment_enabled'
    `);
  }
}
