import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeaturedAndFavorites1751900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salons ADD COLUMN is_featured boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE salons ADD COLUMN featured_until timestamptz`);
    await q.query(`CREATE INDEX salons_featured_idx ON salons(is_featured) WHERE is_featured = true`);

    await q.query(`
      CREATE TABLE salon_favorites (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, salon_id)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_favorites`);
    await q.query(`DROP INDEX salons_featured_idx`);
    await q.query(`ALTER TABLE salons DROP COLUMN featured_until`);
    await q.query(`ALTER TABLE salons DROP COLUMN is_featured`);
  }
}
