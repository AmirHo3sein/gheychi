import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION = 'audit:action';

export interface AuditActionMetadata {
  action: string;
  targetType: string;
}

/**
 * Marks an admin mutation handler for audit capture. Read endpoints are never
 * annotated. Only takes effect on handlers whose controller/handler also applies
 * AuditInterceptor via @UseInterceptors.
 */
export const AuditAction = (action: string, targetType: string) =>
  SetMetadata(AUDIT_ACTION, { action, targetType });
