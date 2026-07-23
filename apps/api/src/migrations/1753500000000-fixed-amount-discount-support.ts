import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixedAmountDiscountSupport1753500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Slice 6 (spec section 2/3/10): a coupon can now carry EITHER a percent discount
    // OR a fixed-toman discount, never both, never neither. discount_percent (the
    // original, sole shape) loses its NOT NULL; discount_fixed_amount is the new,
    // equally-nullable counterpart. The CHECK below is the DB-level guarantee that
    // "exactly one of the two is set" holds for every row, old and new alike --
    // Postgres evaluates it against every pre-existing row too, so this migration
    // itself is proof every coupon that exists today already satisfies it (they all
    // have a non-null discount_percent and a null discount_fixed_amount).
    await q.query(
      `ALTER TABLE coupons ADD COLUMN discount_fixed_amount bigint NULL CHECK (discount_fixed_amount IS NULL OR discount_fixed_amount > 0)`,
    );
    await q.query(`ALTER TABLE coupons ALTER COLUMN discount_percent DROP NOT NULL`);
    await q.query(
      `ALTER TABLE coupons ADD CONSTRAINT coupons_discount_shape_chk
        CHECK ((discount_percent IS NOT NULL) <> (discount_fixed_amount IS NOT NULL))`,
    );

    // Bookings gain the same mutually-exclusive pairing as coupons, for the same
    // reason: bookings.discount_percent (existing, int) cannot represent a
    // fixed-toman discount without lying about the mechanism that actually applied.
    // Rather than approximate a fixed-amount win as a display-only percent (lossy,
    // and easy for a future reader to mistake for the literal discount type), this
    // records the real fixed amount losslessly, mirroring coupons' own shape exactly.
    // Both stay NULL when no discount applied at all (unchanged, pre-existing case).
    // originalPriceSnapshot (existing) already holds the pre-discount price regardless
    // of which of the two columns below is populated, so "amount saved" is always
    // reconstructable without needing to know which kind won.
    await q.query(
      `ALTER TABLE bookings ADD COLUMN discount_fixed_amount bigint NULL CHECK (discount_fixed_amount IS NULL OR discount_fixed_amount > 0)`,
    );
    await q.query(
      `ALTER TABLE bookings ADD CONSTRAINT bookings_discount_shape_chk
        CHECK (NOT (discount_percent IS NOT NULL AND discount_fixed_amount IS NOT NULL))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bookings DROP CONSTRAINT bookings_discount_shape_chk`);
    await q.query(`ALTER TABLE bookings DROP COLUMN discount_fixed_amount`);

    await q.query(`ALTER TABLE coupons DROP CONSTRAINT coupons_discount_shape_chk`);
    // Deliberately NOT backfilled -- if any row somehow has discount_percent NULL at
    // this point (i.e. a fixed_discount coupon was ever created), re-adding NOT NULL
    // below fails loudly. That's correct: silently backfilling a fake percent onto a
    // fixed-amount coupon would misrepresent real, possibly still-active discount
    // terms. A revert past this point requires a human to first decide what to do
    // with any such rows.
    await q.query(`ALTER TABLE coupons ALTER COLUMN discount_percent SET NOT NULL`);
    await q.query(`ALTER TABLE coupons DROP COLUMN discount_fixed_amount`);
  }
}
