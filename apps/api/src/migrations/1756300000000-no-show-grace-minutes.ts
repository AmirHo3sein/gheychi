import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `no_show_grace_minutes` -- how long AFTER a booking's start time a salon must wait
 * before it may record a no-show.
 *
 * Before this, updateStatus() accepted `no_show` on any confirmed booking, including one
 * days in the future: a salon could forfeit a customer's deposit the moment it was paid,
 * and because `no_show` is not a cancellable status the customer then had no route to a
 * refund they were still inside their cancellation window for.
 *
 * Seeded 30 minutes: long enough that a customer who is merely late is not written off,
 * short enough that an owner isn't left waiting on a genuinely absent one. Admin-editable
 * like every other platform-config number -- deliberately NOT a per-salon setting and
 * never salon-owner-editable, since it is the customer's protection against the salon.
 */
export class NoShowGraceMinutes1756300000000 implements MigrationInterface {
  name = 'NoShowGraceMinutes1756300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO platform_config (key, value) VALUES ('no_show_grace_minutes', '30')
       ON CONFLICT (key) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM platform_config WHERE key = 'no_show_grace_minutes'`);
  }
}
