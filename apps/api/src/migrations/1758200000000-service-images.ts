import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One optional primary image per salon service. `image_url` is what upload() returned;
 * `image_storage_key` is what StorageReconciliationJob and the replace/remove paths
 * operate on. The CHECK keeps the pair all-or-nothing, so a row can never point at a URL
 * whose object nothing can clean up (or hold a key with nothing displayed).
 */
export class ServiceImages1758200000000 implements MigrationInterface {
  name = 'ServiceImages1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE salon_services ADD COLUMN image_url varchar NULL, ADD COLUMN image_storage_key varchar NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE salon_services ADD CONSTRAINT salon_services_image_shape_chk
         CHECK ((image_url IS NULL) = (image_storage_key IS NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salon_services DROP CONSTRAINT salon_services_image_shape_chk`);
    await queryRunner.query(`ALTER TABLE salon_services DROP COLUMN image_storage_key, DROP COLUMN image_url`);
  }
}
