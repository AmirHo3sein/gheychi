import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two service-image follow-ups:
 *
 * 1. `image_removed_by_admin_at` -- stamped by an admin takedown
 *    (SalonServicesService.adminRemoveImage, same locked tx that clears the image), cleared
 *    by the owner's next upload/remove. It is the owner's notice in the provider panel; it
 *    never leaves the owner/admin surfaces.
 *
 * 2. An archived service can never hold an image. Archive already clears it in the same
 *    locked transaction; this backfills rows archived before that rule and adds a CHECK so
 *    no future path can reintroduce one. The cleared objects become unreferenced and are
 *    deleted by StorageReconciliationJob's orphan pass: its grace period is measured from
 *    each object's own lastModified (upload time), not from when it became unreferenced, so
 *    these long-uploaded files go on the next hourly run.
 *
 * down() drops the constraint and column only. The cleared images are NOT restored -- the
 * rows no longer reference them and the files are swept by reconciliation.
 */
export class ServiceImageRemovalAndArchiveInvariant1758300000000 implements MigrationInterface {
  name = 'ServiceImageRemovalAndArchiveInvariant1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salon_services ADD COLUMN image_removed_by_admin_at timestamptz NULL`);
    await queryRunner.query(
      `UPDATE salon_services SET image_url = NULL, image_storage_key = NULL
        WHERE is_active = false AND image_storage_key IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_archived_no_image_chk
         CHECK (is_active OR image_url IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_archived_no_image_chk`);
    await queryRunner.query(`ALTER TABLE salon_services DROP COLUMN image_removed_by_admin_at`);
  }
}
