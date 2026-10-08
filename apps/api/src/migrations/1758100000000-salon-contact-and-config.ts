import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trust & launch readiness (salon side):
 *  - `salons.contact_phone` -- the salon's optional PUBLIC contact number (never the
 *    owner's account phone). Shape is validated in the DTO; the DB only bounds the length.
 *  - Clamps a stored `no_show_grace_minutes` that sits outside 0..1440 (previously
 *    writable through PATCH /admin/config, then rejected at boot). The down migration
 *    cannot restore the original out-of-range value, which is never wanted back.
 */
export class SalonContactAndConfig1758100000000 implements MigrationInterface {
  name = 'SalonContactAndConfig1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons ADD COLUMN contact_phone varchar(20) NULL`);
    await queryRunner.query(
      `UPDATE platform_config
          SET value = to_jsonb(LEAST(GREATEST((value #>> '{}')::numeric, 0), 1440))
        WHERE key = 'no_show_grace_minutes'
          AND jsonb_typeof(value) = 'number'
          AND ((value #>> '{}')::numeric < 0 OR (value #>> '{}')::numeric > 1440)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons DROP COLUMN contact_phone`);
  }
}
