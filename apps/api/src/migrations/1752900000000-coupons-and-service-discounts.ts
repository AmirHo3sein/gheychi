import { MigrationInterface, QueryRunner } from 'typeorm';

export class CouponsAndServiceDiscounts1752900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Per-service discount -- a direct percent off a single SalonService, set by its
    // owning provider. NULL means "no discount" (distinct from 0, which isn't allowed).
    await q.query(`ALTER TABLE salon_services ADD COLUMN discount_percent int`);
    await q.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_discount_percent_check
        CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 100))`,
    );

    // Coupon codes. salon_id NULL means platform-wide (admin-created); non-null means
    // scoped to that salon (provider-created). `code` is globally unique across the
    // whole platform (both scopes share one namespace) -- the application layer
    // normalizes to uppercase+trim before every insert/lookup, so the unique index
    // below is effectively case-insensitive in practice even though Postgres itself
    // just sees plain varchar equality.
    await q.query(`
      CREATE TABLE coupons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(30) NOT NULL,
        salon_id uuid REFERENCES salons(id) ON DELETE CASCADE,
        discount_percent int NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
        expires_at timestamptz,
        max_redemptions int CHECK (max_redemptions IS NULL OR max_redemptions > 0),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX coupons_code_uidx ON coupons (code)`);
    await q.query(`CREATE INDEX coupons_salon_idx ON coupons (salon_id)`);

    // One redemption row per (coupon, booking) is the audit trail; the UNIQUE(coupon_id,
    // user_id) constraint is what actually makes "one redemption per user per code"
    // race-safe at the DB level -- two concurrent bookings by the same user with the
    // same code can only ever result in one surviving row, the other fails with 23505.
    await q.query(`
      CREATE TABLE coupon_redemptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        discount_amount bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT coupon_redemptions_coupon_user_uidx UNIQUE (coupon_id, user_id)
      )`);
    await q.query(`CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id)`);

    // Bookings gain a snapshot of whatever discount (service and/or coupon) was applied
    // at hold-creation time -- price_snapshot already holds the final (discounted) price,
    // these three columns record what produced it. coupon_id ON DELETE SET NULL: a
    // coupon can be deactivated/deleted later without invalidating booking history.
    await q.query(`ALTER TABLE bookings ADD COLUMN coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE bookings ADD COLUMN discount_percent int`);
    await q.query(`ALTER TABLE bookings ADD COLUMN original_price_snapshot bigint`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bookings DROP COLUMN original_price_snapshot`);
    await q.query(`ALTER TABLE bookings DROP COLUMN discount_percent`);
    await q.query(`ALTER TABLE bookings DROP COLUMN coupon_id`);
    await q.query(`DROP TABLE coupon_redemptions`);
    await q.query(`DROP TABLE coupons`);
    await q.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_discount_percent_check`);
    await q.query(`ALTER TABLE salon_services DROP COLUMN discount_percent`);
  }
}
