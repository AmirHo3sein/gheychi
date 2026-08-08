import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerScheduleExceptions1754800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // NULL (the original, still most-common meaning) = the whole salon is closed that date;
    // set = only this one worker is off, salon and every other worker unaffected. The old
    // plain UNIQUE(salon_id, date) is dropped because Postgres treats NULL as always-distinct
    // in a unique constraint, so it would have silently allowed a whole-salon row AND a
    // per-worker row to coexist for the same date but never caught two whole-salon rows for
    // the same date once worker_id could also be non-null -- two partial indexes below
    // enforce uniqueness correctly within each case instead.
    await q.query(`
      ALTER TABLE schedule_exceptions ADD COLUMN worker_id uuid NULL REFERENCES workers(id) ON DELETE CASCADE;
      ALTER TABLE schedule_exceptions DROP CONSTRAINT schedule_exceptions_salon_id_date_key;
      CREATE UNIQUE INDEX schedule_exceptions_salon_date_wholesalon_uidx ON schedule_exceptions (salon_id, date) WHERE worker_id IS NULL;
      CREATE UNIQUE INDEX schedule_exceptions_salon_date_worker_uidx ON schedule_exceptions (salon_id, date, worker_id) WHERE worker_id IS NOT NULL;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP INDEX schedule_exceptions_salon_date_worker_uidx;
      DROP INDEX schedule_exceptions_salon_date_wholesalon_uidx;
      ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_salon_id_date_key UNIQUE (salon_id, date);
      ALTER TABLE schedule_exceptions DROP COLUMN worker_id;
    `);
  }
}
