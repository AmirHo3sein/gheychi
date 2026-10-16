import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type AlertSeverity = 'critical' | 'warning';
// What the read side reports for every row: an alert's stored severity, or 'info' for an
// ordinary workflow notification (salon resubmitted, report created, ...).
export type NotificationSeverity = AlertSeverity | 'info';
export const NOTIFICATION_SEVERITIES: readonly NotificationSeverity[] = ['critical', 'warning', 'info'];

// Every `type` a row is written with: 'alert' (AlertsService via emitAlert) plus each
// AdminNotificationsService.emit() call site. Validates the list endpoint's ?type= filter,
// so a new emit() type must be added here or it cannot be filtered on.
export const ADMIN_NOTIFICATION_TYPES = [
  'alert',
  'report_created',
  'salon_resubmitted',
  'salon_material_edit',
  'category_requested',
] as const;
export type AdminNotificationType = (typeof ADMIN_NOTIFICATION_TYPES)[number];

@Entity('admin_notifications')
export class AdminNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  link: string | null;

  // Set only on type='alert' rows (AlertsService.raise). NULL everywhere else -- see the
  // 1758400000000 migration for why old alert rows are NULL too.
  @Column({ type: 'varchar', length: 16, nullable: true })
  severity: AlertSeverity | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
