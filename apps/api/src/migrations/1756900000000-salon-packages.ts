import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonPackages1756900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Catalog/display concept only -- a package is never itself booked, paid for,
    // refunded, or commissioned; each constituent service still goes through the
    // existing, unchanged single-service booking flow. That's why there is no
    // worker/availability/deposit column here at all: none of that machinery ever reads
    // this table. price/price_max/pricing_type mirror salon_services' own shape exactly
    // (same CHECK below) but are purely informational ("usually around 2,500,000 toman"),
    // never charged directly. duration_min/duration_max are likewise advisory only -- the
    // booking engine never reads them; each item's own service.duration_min is what
    // actually governs that item's own booking.
    await q.query(`
      CREATE TABLE salon_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        name varchar(150) NOT NULL,
        description text NULL,
        is_active boolean NOT NULL DEFAULT true,
        pricing_type varchar(10) NOT NULL DEFAULT 'quote',
        price bigint NULL,
        price_max bigint NULL,
        duration_min int NULL,
        duration_max int NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX salon_packages_salon_idx ON salon_packages(salon_id)`);
    await q.query(
      `ALTER TABLE salon_packages ADD CONSTRAINT salon_packages_pricing_type_chk
        CHECK (pricing_type IN ('fixed', 'from', 'range', 'quote'))`,
    );
    await q.query(
      `ALTER TABLE salon_packages ADD CONSTRAINT salon_packages_pricing_shape_chk
        CHECK (
          (pricing_type = 'quote' AND price IS NULL AND price_max IS NULL)
          OR (pricing_type IN ('fixed', 'from') AND price IS NOT NULL AND price_max IS NULL)
          OR (pricing_type = 'range' AND price IS NOT NULL AND price_max IS NOT NULL AND price_max >= price)
        )`,
    );
    await q.query(
      `ALTER TABLE salon_packages ADD CONSTRAINT salon_packages_duration_shape_chk
        CHECK (duration_max IS NULL OR (duration_min IS NOT NULL AND duration_max >= duration_min))`,
    );

    // A package's items -- an ordered, deduplicated set of the salon's OWN existing
    // services. service_id is deliberately NOT ON DELETE CASCADE (matches
    // worker_services' and salon_services.category_id's own restrict precedent): a
    // service still listed in a package cannot be hard-deleted out from under it (moot
    // in practice today since services are only ever soft-deactivated, but the same
    // restrict posture as every other service reference in this schema). package_id IS
    // cascaded -- deleting a package takes its own item rows with it, same as
    // salon_categories/salon_favorites cascading on their owning salon.
    await q.query(`
      CREATE TABLE salon_package_items (
        package_id uuid NOT NULL REFERENCES salon_packages(id) ON DELETE CASCADE,
        service_id uuid NOT NULL REFERENCES salon_services(id),
        sort_order int NOT NULL DEFAULT 0,
        PRIMARY KEY (package_id, service_id)
      )`);
    await q.query(`CREATE INDEX salon_package_items_service_idx ON salon_package_items(service_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_package_items`);
    await q.query(`DROP TABLE salon_packages`);
  }
}
