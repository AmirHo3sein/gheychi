import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentRefunds1752700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_requested_at timestamptz`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refund_ref_id varchar(64)`);
    await queryRunner.query(`ALTER TABLE payments ADD COLUMN refunded_at timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refunded_at`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_ref_id`);
    await queryRunner.query(`ALTER TABLE payments DROP COLUMN refund_requested_at`);
  }
}
