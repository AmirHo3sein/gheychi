import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonShowcase1752800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Rich profile -- three nullable columns on salons (description stays untouched).
    await q.query(`ALTER TABLE salons ADD COLUMN tagline varchar(120)`);
    await q.query(`ALTER TABLE salons ADD COLUMN about text`);
    await q.query(`ALTER TABLE salons ADD COLUMN instagram_handle varchar(30)`);

    await q.query(`
      CREATE TABLE salon_stories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        url varchar(500) NOT NULL,
        storage_key varchar(500) NOT NULL,
        caption varchar(200),
        service_id uuid REFERENCES salon_services(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT 'published',
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      )`);
    await q.query(`CREATE INDEX salon_stories_public_idx ON salon_stories (salon_id, status, expires_at)`);
    await q.query(`CREATE INDEX salon_stories_cleanup_idx ON salon_stories (expires_at)`);

    await q.query(`
      CREATE TABLE portfolio_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id),
        url varchar(500) NOT NULL,
        storage_key varchar(500) NOT NULL,
        caption varchar(300),
        service_id uuid REFERENCES salon_services(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT 'published',
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX portfolio_items_salon_idx ON portfolio_items (salon_id, sort_order)`);

    // Reports gain two new (nullable) targets; salon_id stays NOT NULL and is derived
    // from the story/portfolio item, same as review reports. ON DELETE SET NULL keeps
    // the report (and its reason text) when a provider deletes the reported content.
    await q.query(`ALTER TABLE reports ADD COLUMN story_id uuid REFERENCES salon_stories(id) ON DELETE SET NULL`);
    await q.query(
      `ALTER TABLE reports ADD COLUMN portfolio_item_id uuid REFERENCES portfolio_items(id) ON DELETE SET NULL`,
    );
    // target_type is the discriminator that SURVIVES the ON DELETE SET NULL cascade:
    // once a reported story/portfolio item is deleted, every target FK is null and the
    // row would otherwise be indistinguishable from a salon-target report (breaking
    // both the admin UI's placeholder and the dedup index below). Set server-side in
    // ReportsService.create(), never client-supplied. Backfill: story/portfolio
    // reports cannot pre-exist this migration, so review_id decides.
    await q.query(`ALTER TABLE reports ADD COLUMN target_type varchar(20)`);
    await q.query(
      `UPDATE reports SET target_type = CASE WHEN review_id IS NOT NULL THEN 'review' ELSE 'salon' END`,
    );
    await q.query(`ALTER TABLE reports ALTER COLUMN target_type SET NOT NULL`);
    // Rebuild the open-report dedup index (from 1752500000000-platform-hardening) to
    // cover the two new target columns -- otherwise a second open report on the same
    // story would collide with a plain salon report from the same reporter.
    //
    // The extra WHERE clause excludes ORPHANED content reports (story/portfolio target
    // whose FK was nulled by the delete cascade): without it, the cascade's
    // `UPDATE reports SET story_id = NULL` could produce a tuple identical to another
    // open report's entry (e.g. an open salon report from the same reporter, or a
    // second orphaned story report) and Postgres would abort the provider's DELETE
    // with a 23505 -- a 500 that permanently blocks deleting reported content.
    // Salon reports (target_type='salon', all target FKs null by construction) stay
    // fully deduped; review reports keep review_id (reviews are never hard-deleted).
    await q.query(`DROP INDEX reports_open_target_uidx`);
    await q.query(`
      CREATE UNIQUE INDEX reports_open_target_uidx
        ON reports (reporter_id, salon_id,
          COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(story_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(portfolio_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE status = 'open'
          AND NOT (target_type IN ('story', 'portfolio') AND story_id IS NULL AND portfolio_item_id IS NULL)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX reports_open_target_uidx`);
    await q.query(`ALTER TABLE reports DROP COLUMN target_type`);
    await q.query(`ALTER TABLE reports DROP COLUMN portfolio_item_id`);
    await q.query(`ALTER TABLE reports DROP COLUMN story_id`);
    await q.query(`
      CREATE UNIQUE INDEX reports_open_target_uidx
        ON reports (reporter_id, salon_id, COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE status = 'open'`);
    await q.query(`DROP TABLE portfolio_items`);
    await q.query(`DROP TABLE salon_stories`);
    await q.query(`ALTER TABLE salons DROP COLUMN instagram_handle`);
    await q.query(`ALTER TABLE salons DROP COLUMN about`);
    await q.query(`ALTER TABLE salons DROP COLUMN tagline`);
  }
}
