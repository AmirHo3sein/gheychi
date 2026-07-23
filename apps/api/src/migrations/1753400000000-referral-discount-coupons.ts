import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralDiscountCoupons1753400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // The ONE behavioral hook a percent_discount referral reward needs on top of the
    // existing, tested `coupons` table (spec section 2/3, Slice 5): a referral-issued
    // coupon is restricted to the one user it was granted to. NULL (the default, and
    // the value for every pre-existing/manually-entered coupon) means "unrestricted,
    // exactly current behavior" -- see CouponsService.resolveAndValidate.
    await q.query(`ALTER TABLE coupons ADD COLUMN issued_to_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX coupons_issued_to_user_idx ON coupons(issued_to_user_id) WHERE issued_to_user_id IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX coupons_issued_to_user_idx`);
    await q.query(`ALTER TABLE coupons DROP COLUMN issued_to_user_id`);
  }
}
