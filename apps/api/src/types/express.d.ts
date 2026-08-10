import { User } from '../users/user.entity';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      salonId?: string;
      requestId?: string;
      // Stashed by a handful of high-stakes admin mutation handlers (wallet adjust,
      // user/salon status changes, platform config updates) before they perform their
      // write, so AuditInterceptor can fold a real before/after diff into the audit_log
      // payload instead of just the raw request body. Left unset by every other audited
      // route -- AuditInterceptor falls back to its original request-body-only payload
      // whenever auditBefore is undefined, so this is purely additive. See
      // audit.interceptor.ts's payload-building comment for the full contract.
      auditBefore?: unknown;
      auditAfter?: unknown;
    }
  }
}
