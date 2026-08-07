import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION = 'audit:action';

export interface AuditActionMetadata {
  action: string;
  targetType: string;
  targetIdParam: string;
}

/**
 * Marks an admin mutation handler for audit capture. Read endpoints are never
 * annotated. Only takes effect on handlers whose controller/handler also applies
 * AuditInterceptor via @UseInterceptors.
 * By default the audited route must expose its target as the `:id` route param;
 * pass `targetIdParam` for a route whose param is named differently (e.g. `:type`) --
 * otherwise the recorded row silently carries targetId: null.
 */
export const AuditAction = (action: string, targetType: string, targetIdParam = 'id') =>
  SetMetadata(AUDIT_ACTION, { action, targetType, targetIdParam });
