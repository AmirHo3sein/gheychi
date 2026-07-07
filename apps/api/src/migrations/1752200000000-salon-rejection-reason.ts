import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonRejectionReason1752200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons ADD COLUMN rejection_reason text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons DROP COLUMN rejection_reason`);
  }
}
