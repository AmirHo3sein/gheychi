import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonPhotoStorageKey1752100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_photos ADD COLUMN storage_key varchar NOT NULL DEFAULT ''`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_photos DROP COLUMN storage_key`);
  }
}
