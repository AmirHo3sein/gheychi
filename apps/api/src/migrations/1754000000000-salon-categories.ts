import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonCategories1754000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // category_id deliberately NOT ON DELETE CASCADE -- matches salon_services.category_id's
    // existing "can't delete a category still in use" restrict behavior (see
    // admin-categories.controller.ts's own delete guard). salon_id IS cascaded: a salon
    // being removed should take its own tags with it, same as salon_favorites.
    await q.query(`
      CREATE TABLE salon_categories (
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        category_id int NOT NULL REFERENCES service_categories(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (salon_id, category_id)
      )`);
    await q.query(`CREATE INDEX salon_categories_category_idx ON salon_categories(category_id)`);

    // Backfill from each salon's existing services so a salon that was already
    // findable under a category (via the old EXISTS-over-salon_services filter this
    // migration's follow-up code change replaces) doesn't silently vanish from that
    // category the moment the filter switches to reading this table instead.
    await q.query(`
      INSERT INTO salon_categories (salon_id, category_id)
      SELECT DISTINCT salon_id, category_id FROM salon_services WHERE is_active
      ON CONFLICT DO NOTHING`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_categories`);
  }
}
