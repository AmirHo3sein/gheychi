import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduleExceptionTimeRange1754600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // schedule_exceptions has only ever meant "closed all day" (is_closed, no time range).
    // A salon also needs to declare a closure for PART of a day (a supplier visit, a
    // mid-afternoon repair) without losing the rest of that day's normal hours -- both
    // columns NULL keeps today's whole-day meaning unchanged for every existing row; both
    // set narrows the closure to [start_time, end_time) on that date, subtracted from the
    // salon's working-hour ranges at availability-computation time (availability.util.ts).
    // The CHECK keeps "half-specified" (one time set, the other not) impossible at the DB
    // layer, same defensive posture as coupons.discount_percent's own nullable-with-bounds
    // check in 1752900000000-coupons-and-service-discounts.ts.
    await q.query(`
      ALTER TABLE schedule_exceptions
        ADD COLUMN start_time time NULL,
        ADD COLUMN end_time time NULL,
        ADD COLUMN reason varchar(200) NULL,
        ADD CONSTRAINT schedule_exceptions_time_range_chk CHECK (
          (start_time IS NULL AND end_time IS NULL)
          OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
        )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE schedule_exceptions
        DROP CONSTRAINT schedule_exceptions_time_range_chk,
        DROP COLUMN reason,
        DROP COLUMN end_time,
        DROP COLUMN start_time
    `);
  }
}
