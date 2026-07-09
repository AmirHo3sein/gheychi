import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformHardening1752500000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid NOT NULL REFERENCES users(id),
        action varchar(60) NOT NULL,
        target_type varchar(30) NOT NULL,
        target_id varchar(64),
        payload jsonb,
        success boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC)`);
    await q.query(`CREATE INDEX audit_log_actor_idx ON audit_log (actor_id)`);

    await q.query(`
      CREATE TABLE reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id uuid NOT NULL REFERENCES users(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        review_id uuid REFERENCES reviews(id),
        reason text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'open',
        resolution_note text,
        resolved_by uuid REFERENCES users(id),
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX reports_status_created_idx ON reports (status, created_at DESC)`);
    await q.query(`
      CREATE UNIQUE INDEX reports_open_target_uidx
        ON reports (reporter_id, salon_id, COALESCE(review_id, '00000000-0000-0000-0000-000000000000'::uuid))
        WHERE status = 'open'`);

    await q.query(`
      CREATE TABLE admin_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(40) NOT NULL,
        title varchar(200) NOT NULL,
        body varchar(500),
        link varchar(200),
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE INDEX admin_notifications_unread_idx ON admin_notifications (created_at DESC) WHERE read_at IS NULL`,
    );

    await q.query(`ALTER TABLE salons ADD COLUMN suspended_cause varchar(20)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salons DROP COLUMN suspended_cause`);
    await q.query(`DROP TABLE admin_notifications`);
    await q.query(`DROP TABLE reports`);
    await q.query(`DROP TABLE audit_log`);
  }
}
