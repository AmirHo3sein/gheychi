import { HttpException } from '@nestjs/common';

/**
 * A bounded reason label for a *_failures_total / *_rejections_total metric, shared by
 * every call site in this codebase that wraps a method throwing this codebase's own
 * BadRequestException/ConflictException-with-a-`code` convention (see
 * coupon-error-codes.ts/booking-error-codes.ts). Prefers the stable `code` on the
 * exception's response body; falls back to the exception class name for anything else
 * (a plain NotFoundException, a validation BadRequestException with no code, ...), and
 * to `fallback` for a non-HttpException (a genuine bug/infra failure). Never the raw
 * error message -- that's free-form text and would blow the metric's cardinality wide
 * open the first time a message includes an id or a user-typed value.
 */
export function httpExceptionReasonCode(err: unknown, fallback = 'internal_error'): string {
  if (!(err instanceof HttpException)) return fallback;
  const response = err.getResponse();
  const code = typeof response === 'object' && response !== null ? (response as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : err.constructor.name;
}
