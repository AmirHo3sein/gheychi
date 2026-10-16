import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ADMIN_NOTIFICATION_TYPES, AdminNotificationType, NOTIFICATION_SEVERITIES, NotificationSeverity } from '../admin-notification.entity';

export class AdminNotificationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: 'true' | 'false';

  // Closed set, not a free-form string: an unknown type is a client bug worth a 400, not a
  // silently-empty list. A new emit() type must be added to ADMIN_NOTIFICATION_TYPES.
  @IsOptional()
  @IsIn(ADMIN_NOTIFICATION_TYPES)
  type?: AdminNotificationType;

  // Filters on the DISPLAYED severity (severityOf): 'info' = every non-alert row, and a
  // pre-column alert (stored NULL) matches 'warning' -- the same rule the list items report.
  @IsOptional()
  @IsIn(NOTIFICATION_SEVERITIES)
  severity?: NotificationSeverity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
