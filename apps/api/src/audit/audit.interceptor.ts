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

    const req = context
      .switchToHttp()
      .getRequest<{ user: { id: string }; params?: Record<string, string>; body?: unknown }>();
    const base = {
      // Guards run before interceptors, and every audited route runs AuthGuard, so req.user is guaranteed.
      actorId: req.user.id,
      action: meta.action,
      targetType: meta.targetType,
      targetId: req.params?.[meta.targetIdParam] ?? null,
      // req.body is the raw parsed body: the global ValidationPipe whitelists the
      // handler's DTO argument, not req.body itself. Acceptable per spec §3.1 for
      // an admin-only, body-parser-bounded surface.
      payload: req.body ?? null,
    };

    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.audit.record({ ...base, success: true });
        return result;
      }),
      catchError((err) =>
        from(this.audit.record({ ...base, success: false })).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
