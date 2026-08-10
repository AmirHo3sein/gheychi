import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, Observable, throwError } from 'rxjs';
import { AUDIT_ACTION, AuditActionMetadata } from './audit.decorator';
import { AuditService } from './audit.service';

/**
 * Writes one audit_log row per settled admin mutation carrying @AuditAction
 * metadata; passes through untouched otherwise. The insert is awaited on both
 * paths so the row is committed before the HTTP response goes out (keeps the
 * admin panel's follow-up reads and the e2e assertions deterministic), and
 * AuditService.record never throws, so the write can't fail the request.
 * On handler rejection the failure row is written first, then the original
 * error is rethrown untouched.
 *
 * Before/after diff capture (opt-in, additive): this interceptor has no generic
 * way to know which entity/id a given route cares about, so it can't fetch a
 * "prior state" itself. Instead, a handful of high-stakes handlers (wallet
 * adjust, user/salon status changes, platform config updates) fetch their
 * entity's pre-mutation state themselves and stash it on `req.auditBefore`
 * (and, once they have it, the post-mutation state on `req.auditAfter`) before
 * returning -- the same "stash on req, read it back downstream" convention
 * already used by SalonOwnerGuard's req.salonId and the request-logging
 * middleware's req.requestId. When a handler leaves auditBefore unset (every
 * other @AuditAction call site today), payload is exactly `req.body ?? null`,
 * unchanged from before this diff-capture support existed.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditActionMetadata | undefined>(AUDIT_ACTION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<{
      user: { id: string };
      params?: Record<string, string>;
      body?: unknown;
      auditBefore?: unknown;
      auditAfter?: unknown;
    }>();
    const base = {
      // Guards run before interceptors, and every audited route runs AuthGuard, so req.user is guaranteed.
      actorId: req.user.id,
      action: meta.action,
      targetType: meta.targetType,
      targetId: req.params?.[meta.targetIdParam] ?? null,
    };

    // req.body is the raw parsed body: the global ValidationPipe whitelists the
    // handler's DTO argument, not req.body itself. Acceptable per spec §3.1 for
    // an admin-only, body-parser-bounded surface. Read lazily (not hoisted into
    // `base`) so it's evaluated after the handler has run and had a chance to
    // set req.auditBefore/req.auditAfter.
    const buildPayload = (success: boolean): unknown => {
      if (req.auditBefore === undefined) return req.body ?? null;
      const bodyFields = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      return {
        ...bodyFields,
        before: req.auditBefore,
        // A failed mutation never reached its post-write state, so `after` is
        // only ever populated on the success path -- req.auditAfter is either
        // unset (handler threw before computing it) or stale from a different
        // request on a reused object, neither of which should be recorded.
        after: success ? (req.auditAfter ?? null) : null,
      };
    };

    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.audit.record({ ...base, payload: buildPayload(true), success: true });
        return result;
      }),
      catchError((err) =>
        from(this.audit.record({ ...base, payload: buildPayload(false), success: false })).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}
