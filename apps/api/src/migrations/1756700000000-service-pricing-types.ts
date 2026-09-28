import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServicePricingTypes1756700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Every existing service already has a non-null price with no upper bound and no
    // quote-only concept -- 'fixed' is the exact, lossless description of what every
    // current row already means. DEFAULT 'fixed' both backfills every existing row
    // (Postgres applies a non-volatile DEFAULT to existing rows on ADD COLUMN without a
    // full table rewrite) and covers any writer that doesn't yet know about this column.
    await q.query(
      `ALTER TABLE salon_services ADD COLUMN pricing_type varchar(10) NOT NULL DEFAULT 'fixed'`,
    );
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_pricing_type_chk
        CHECK (pricing_type IN ('fixed', 'from', 'range', 'quote'))`,
    );

    // price stops being universally required: a QUOTE service ("price upon consultation")
    // has no number to store at all. FIXED and FROM keep exactly today's single-price
    // shape (FROM's price is its starting/floor value); RANGE adds price_max as the
    // ceiling. The shape CHECK below is the DB-level guarantee that every row's
    // (pricing_type, price, price_max) triple is internally consistent, for old rows and
    // new alike -- this migration running at all is proof every existing row (pricing_type
    // defaulted to 'fixed', price already NOT NULL, price_max NULL) already satisfies it.
    await q.query(`ALTER TABLE salon_services ALTER COLUMN price DROP NOT NULL`);
    await q.query(`ALTER TABLE salon_services ADD COLUMN price_max bigint NULL`);
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_pricing_shape_chk
        CHECK (
          (pricing_type = 'quote' AND price IS NULL AND price_max IS NULL)
          OR (pricing_type IN ('fixed', 'from') AND price IS NOT NULL AND price_max IS NULL)
          OR (pricing_type = 'range' AND price IS NOT NULL AND price_max IS NOT NULL AND price_max >= price)
        )`,
    );

    // A per-service discount is a percentage OFF a known final price -- meaningless for
    // FROM/RANGE (there is no single price to discount from without lying about what the
    // customer will actually pay) and doubly so for QUOTE (no price at all yet). Rather
    // than teach the discount-resolution engine (discount.util.ts) a new "discount off
    // which bound?" question nobody asked for, discounting stays exactly what it already
    // is -- a FIXED-price-only mechanism -- and this CHECK makes that a DB guarantee
    // instead of an app-layer convention that could silently drift.
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_discount_fixed_only_chk
        CHECK (discount_percent IS NULL OR pricing_type = 'fixed')`,
    );

    // duration_min stays the one number the booking/availability engine ever reads --
    // unchanged, still required, still the sole scheduling input. duration_max is purely
    // informational ("takes about 2-4 hours"), shown to the customer alongside
    // duration_min but never consulted by computeAvailableSlots or any overlap check.
    await q.query(`ALTER TABLE salon_services ADD COLUMN duration_max int NULL`);
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_duration_max_chk
        CHECK (duration_max IS NULL OR duration_max >= duration_min)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_duration_max_chk`);
    await q.query(`ALTER TABLE salon_services DROP COLUMN duration_max`);

    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_discount_fixed_only_chk`);

    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_pricing_shape_chk`);
    await q.query(`ALTER TABLE salon_services DROP COLUMN price_max`);
    // Deliberately NOT backfilled if a QUOTE service exists at revert time (price NULL) --
    // re-adding NOT NULL below fails loudly rather than silently inventing a price for a
    // service whose whole point was "no price yet." Same posture as the fixed-amount-
    // discount migration's own down() for coupons.discount_percent.
    await q.query(`ALTER TABLE salon_services ALTER COLUMN price SET NOT NULL`);

    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_pricing_type_chk`);
    await q.query(`ALTER TABLE salon_services DROP COLUMN pricing_type`);
  }
}
