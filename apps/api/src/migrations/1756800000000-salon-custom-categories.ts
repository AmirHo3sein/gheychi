import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonCustomCategories1756800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // A salon-private counterpart to the global, admin-owned service_categories: created
    // and used immediately by the owner, with no admin approval round-trip (unlike
    // category_requests, which exists specifically to grow the GLOBAL list). Deliberately
    // NOT joined into salon_categories (the search-tag table) or the public /categories
    // list -- a custom category must never become a marketplace-wide filter, only a
    // private label the owner uses to organize their own services.
    await q.query(`
      CREATE TABLE salon_custom_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        name varchar(60) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (salon_id, name)
      )`);
    await q.query(`CREATE INDEX salon_custom_categories_salon_idx ON salon_custom_categories(salon_id)`);

    // A service now points at EITHER a system category OR a salon's own custom one, never
    // both, never neither -- same mutually-exclusive-pair shape this codebase already uses
    // for bookings.discount_percent/discount_fixed_amount. custom_category_id is NOT
    // ON DELETE CASCADE, matching category_id's own existing restrict behavior (see
    // admin-categories.controller.ts's delete guard): a custom category still referenced
    // by a service cannot be deleted out from under it.
    await q.query(`ALTER TABLE salon_services ALTER COLUMN category_id DROP NOT NULL`);
    await q.query(
      `ALTER TABLE salon_services ADD COLUMN custom_category_id uuid NULL REFERENCES salon_custom_categories(id)`,
    );
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_category_shape_chk
        CHECK ((category_id IS NOT NULL) <> (custom_category_id IS NOT NULL))`,
    );
    await q.query(
      `CREATE INDEX salon_services_custom_category_idx ON salon_services(custom_category_id)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX salon_services_custom_category_idx`);
    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_category_shape_chk`);
    await q.query(`ALTER TABLE salon_services DROP COLUMN custom_category_id`);
    // Every existing row has category_id set (custom categories didn't exist before this
    // migration), so restoring NOT NULL is always safe here -- unlike the price/discount
    // reverts elsewhere in this feature, there's no "silently invent a value" risk.
    await q.query(`ALTER TABLE salon_services ALTER COLUMN category_id SET NOT NULL`);

    await q.query(`DROP TABLE salon_custom_categories`);
  }
}
