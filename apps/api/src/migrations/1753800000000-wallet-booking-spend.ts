import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletBookingSpend1753800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Deliberately DROP+ADD rather than an unnamed CHECK staying implicit forever --
    // Postgres auto-named the original 'wallet_transactions_type_check' (no explicit
    // CONSTRAINT name in 1753100000000), so this is the exact name to replace.
    await q.query(`ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check`);
    await q.query(`
      ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
        CHECK (type IN ('referral_reward','referral_reversal','admin_adjustment','booking_spend','booking_spend_reversal'))`);

    // How much of a booking's deposit was funded from the customer's wallet balance
    // instead of charged online -- see booking.entity.ts's walletAmountUsed doc
    // comment. Nullable/no default: every pre-existing booking simply never used one.
    await q.query(`ALTER TABLE bookings ADD COLUMN wallet_amount_used bigint NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bookings DROP COLUMN wallet_amount_used`);
    await q.query(`ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check`);
    await q.query(`
      ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
        CHECK (type IN ('referral_reward','referral_reversal','admin_adjustment'))`);
  }
}
