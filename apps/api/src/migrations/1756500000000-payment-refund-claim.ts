import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `payments.refund_claimed_at` -- the in-flight claim that makes a refund's GATEWAY
 * call single-flighted, not just its database write.
 *
 * Before this, PaymentsService.attemptRefund read the payment without a lock, called
 * Zarinpal, and only then ran its status CAS. Two callers (BookingsService.cancel()'s
 * inline attempt racing RefundRetryJob's 5-minute tick, or two API replicas running that
 * job's inline path at once) could both pass the read and both call the refund API. The
 * database stayed consistent -- the loser's CAS matched zero rows -- but the external
 * money API was hit twice, and Zarinpal permits only ONE refund request per transaction
 * (see docs/deployment/ZARINPAL-REFUND-VERIFICATION.md); the "a repeat refund is
 * idempotent" assumption was never verifiable against a sandbox in the first place.
 *
 * NULL is the correct backfill for every existing row: no refund is in flight across a
 * deploy, and a NULL claim is exactly what makes a payment claimable.
 */
export class PaymentRefundClaim1756500000000 implements MigrationInterface {
  name = 'PaymentRefundClaim1756500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_claimed_at timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN IF EXISTS refund_claimed_at`);
  }
}
