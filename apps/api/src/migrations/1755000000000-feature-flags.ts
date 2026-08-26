import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeatureFlags1755000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // All seeded true -- preserves today's behavior exactly until an admin explicitly
    // flips one off via PATCH /admin/feature-flags. Kept as separate rows in the existing
    // platform_config table (not a new table) since the storage/caching/admin-mutation
    // machinery already fits; only the numeric-specific validation path
    // (PlatformConfigService.getNumber/REQUIRED_PLATFORM_CONFIG_KEYS) is bypassed for these
    // via a parallel FEATURE_FLAG_KEYS list and getFeatureFlags() getter.
    await q.query(`
      INSERT INTO platform_config (key, value) VALUES
        ('feature_reviews_enabled', 'true'),
        ('feature_stories_enabled', 'true'),
        ('feature_portfolio_enabled', 'true'),
        ('feature_referrals_enabled', 'true'),
        ('feature_coupons_enabled', 'true')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM platform_config WHERE key IN (
        'feature_reviews_enabled',
        'feature_stories_enabled',
        'feature_portfolio_enabled',
        'feature_referrals_enabled',
        'feature_coupons_enabled'
      )
    `);
  }
}
