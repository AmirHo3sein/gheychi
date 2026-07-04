import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingPaymentsSchema1751700000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE bookings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        service_id uuid NOT NULL REFERENCES salon_services(id),
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        price_snapshot bigint NOT NULL,
        deposit_amount bigint NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pending_payment',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX bookings_salon_time_idx ON bookings(salon_id, starts_at, ends_at)`);
    await q.query(`CREATE INDEX bookings_user_idx ON bookings(user_id)`);
    await q.query(`CREATE INDEX bookings_status_idx ON bookings(status)`);

    await q.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id),
        amount bigint NOT NULL,
        gateway varchar(20) NOT NULL DEFAULT 'zarinpal',
        authority varchar(64),
        ref_id varchar(64),
        status varchar(20) NOT NULL DEFAULT 'initiated',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX payments_booking_uidx ON payments(booking_id)`);
    await q.query(`CREATE INDEX payments_authority_idx ON payments(authority)`);
    await q.query(`CREATE INDEX payments_status_idx ON payments(status, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payments`);
    await q.query(`DROP TABLE bookings`);
  }
}
