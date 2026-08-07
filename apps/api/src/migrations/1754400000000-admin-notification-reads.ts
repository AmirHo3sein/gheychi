import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminNotificationReads1754400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Per-caller read state -- today's single admin_notifications.read_at column means
    // one admin marking a notification read marks it read for every admin. That column
    // is left in place (not dropped, not written to by the new code path) purely for
    // rollback safety; it is no longer the source of truth for "is this read".
    //
    // No backfill: there is no way to know, retroactively, which specific admin read
    // which historical notification under the old shared-state model. Every notification
    // starts unread for every admin under the new model -- the honest default, not a guess.
    await q.query(`
      CREATE TABLE admin_notification_reads (
        notification_id uuid NOT NULL REFERENCES admin_notifications(id) ON DELETE CASCADE,
        admin_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (notification_id, admin_id)
      )`);
    // Covers unreadCount()/list(unread=true)'s per-admin "which notifications has THIS
    // admin read" lookup.
    await q.query(`CREATE INDEX admin_notification_reads_admin_idx ON admin_notification_reads(admin_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE admin_notification_reads`);
  }
}
