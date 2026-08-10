import { ArgumentsHost, Catch, HttpException, Inject } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';
import { ERROR_TRACKING_PROVIDER, ErrorTrackingService } from './error-tracking.service';

/**
 * Catch-all safety net, registered as `APP_FILTER` in `app.module.ts`. Its ONLY job
 * beyond NestJS's own default exception handling is the `capture()` side-effect below --
 * `super.catch()` is what actually produces the response, so the response is
 * byte-for-byte what NestJS would have sent with no filter registered at all (this class
 * subclasses `BaseExceptionFilter` from `@nestjs/core` precisely so that behavior comes
 * for free instead of being hand-reimplemented and risking drift).
 *
 * Before this file, the codebase deliberately had no global exception filter -- see
 * CLAUDE.md's former "no global exception filter" note (`docs/technical-overview/
 * 02-system-architecture.md` said the same) -- so this is new, additive plumbing (a
 * capture side-effect), not a change to any existing error response's body or status.
 *
 * Only 5xx / non-`HttpException` failures are captured (mirrors Sentry's own default
 * NestJS integration behavior). Ordinary business-rule throws below 500
 * (`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`,
 * ...) are expected control flow throughout this codebase -- capturing every one of them
 * would flood a real error tracker with routine 404s/400s and drown out genuine bugs.
 */
@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  constructor(@Inject(ERROR_TRACKING_PROVIDER) private readonly errorTracking: ErrorTrackingService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (this.shouldCapture(exception)) {
      this.capture(exception, host);
    }
    super.catch(exception, host);
  }

  private shouldCapture(exception: unknown): boolean {
    if (exception instanceof HttpException) {
      return exception.getStatus() >= 500;
    }
    return true;
  }

  private capture(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.errorTracking.captureException(exception);
      return;
    }
    // req.path (not req.originalUrl) -- deliberately excludes the query string, which
    // could carry an accidentally-sensitive value (e.g. a stray ?token=... on some
    // future endpoint) that has no business reaching an error-tracking backend.
    const req = host.switchToHttp().getRequest<Request>();
    this.errorTracking.captureException(exception, {
      requestId: req.requestId,
      userId: req.user?.id,
      route: `${req.method} ${req.path}`,
    });
  }
}
