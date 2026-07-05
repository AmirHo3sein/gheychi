import { MigrationInterface, QueryRunner } from 'typeorm';

export class PushAndReminders1752000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE push_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        p256dh varchar(255) NOT NULL,
        auth varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id)`);

    await q.query(`ALTER TABLE bookings ADD COLUMN reminded_at timestamptz`);

    await q.query(`INSERT INTO platform_config (key, value) VALUES ('reminder_lead_hours', '3')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM platform_config WHERE key = 'reminder_lead_hours'`);
    await q.query(`ALTER TABLE bookings DROP COLUMN reminded_at`);
    await q.query(`DROP TABLE push_subscriptions`);
  }
}
