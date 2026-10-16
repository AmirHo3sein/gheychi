import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `admin_notifications.severity` -- the severity AlertsService.raise() was already given
 * ('critical' pages by SMS, 'warning' does not) but never stored, so the admin panel could
 * not tell a stuck refund from a resubmitted salon. Written only for `type = 'alert'` rows;
 * every other notification type stays NULL and is reported as 'info' on read.
 *
 * Deliberately no backfill: an alert row written before this column existed has no record
 * of which severity it was raised with, and guessing 'critical' would page-shout old noise
 * while guessing 'warning' is merely conservative. The read side maps a NULL alert to
 * 'warning' (see AdminNotificationsService.severityOf).
 */
export class AdminNotificationSeverity1758400000000 implements MigrationInterface {
  name = 'AdminNotificationSeverity1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE admin_notifications
         ADD COLUMN severity varchar(16) NULL
         CONSTRAINT admin_notifications_severity_chk CHECK (severity IN ('critical', 'warning'))`,
    );
    // Backs the dashboard's "unread critical alerts" count, which filters on exactly this.
    await queryRunner.query(
      `CREATE INDEX admin_notifications_alert_severity_idx ON admin_notifications (severity, created_at)
         WHERE type = 'alert'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX admin_notifications_alert_severity_idx`);
    await queryRunner.query(`ALTER TABLE admin_notifications DROP COLUMN severity`);
  }
}
