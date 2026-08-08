import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingSourceAndNotes1754700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Every booking today comes through the online flow (createHold) -- 'online' as the
    // DEFAULT (not just the initial value for new rows) means every existing row backfills
    // correctly in the same statement, and createHold itself never has to set this
    // explicitly. `notes` has no equivalent existing meaning to preserve -- always null
    // until an owner's manual booking (BookingsService.createManual) sets it.
    await q.query(`
      ALTER TABLE bookings
        ADD COLUMN source varchar(20) NOT NULL DEFAULT 'online',
        ADD COLUMN notes varchar(500) NULL,
        ADD CONSTRAINT bookings_source_chk CHECK (source IN ('online', 'manual'))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_source_chk,
        DROP COLUMN notes,
        DROP COLUMN source
    `);
  }
}
