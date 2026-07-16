import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentRefunds1752700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_requested_at timestamptz`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_ref_id varchar(64)`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refunded_at timestamptz`);
    // Before this plan, 'refunded' was a bookkeeping label meaning "the customer
    // is owed a refund" -- no gateway refund ever happened. The new semantics
    // reserve 'refunded' for gateway-confirmed refunds (refund_ref_id recorded),
    // so legacy rows convert to refund_pending and RefundRetryJob issues their
    // real refunds on its next ticks. Without this backfill, customers whose
    // money was never returned would see "refund complete".
    await queryRunner.query(
      `UPDATE payments SET status = 'refund_pending', refund_requested_at = now() WHERE status = 'refunded'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the pre-plan bookkeeping semantics for rows the backfill converted
    // (or that were queued after it): on the old schema, "owed" was spelled
    // 'refunded'. Gateway-confirmed rows keep 'refunded', which is also correct
    // in the old world.
    await queryRunner.query(`UPDATE payments SET status = 'refunded' WHERE status = 'refund_pending'`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refunded_at`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_ref_id`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_requested_at`);
  }
}
