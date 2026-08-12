import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';

const HEADER_NAME = 'x-backup-report-secret';

/**
 * Guards POST /api/internal/backup-report (see backup-report.controller.ts). That route
 * carries @Public() purely to skip AuthGuard's session-cookie check -- the caller is
 * docker/backup/backup.sh, a service with no user session, not a browser -- but @Public()
 * alone would leave the route wide open, so this guard is the REAL access control.
 *
 * This is not optional defense-in-depth on top of network isolation: read literally,
 * Caddyfile's `{$DOMAIN_API} { reverse_proxy api:3002 }` block has no path restriction
 * at all -- it forwards every path on api.gheychi.co (including /api/internal/*) straight
 * to the api container. There is no separate block scoping /internal/* away from the
 * public internet. So this route is reachable from outside today, via the normal public
 * domain, not merely "reachable if someone hits the container port directly in some
 * future misconfigured setup." The shared secret is the actual gate.
 *
 * Compares SHA-256 digests of the provided/expected secrets rather than the raw strings:
 * timingSafeEqual throws on mismatched buffer lengths, and falling back to `===` (or
 * catching that throw) on a length mismatch leaks the secret's length and lets response
 * timing narrow it down byte-by-byte. Digests are always 32 bytes, so the comparison is
 * both length-invariant and still constant-time. Never logs the provided or expected
 * value -- only that a request was rejected.
 */
@Injectable()
export class BackupReportSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers[HEADER_NAME];
    // getOrThrow, not get(..., fallback): a missing BACKUP_REPORT_SECRET must fail loud
    // at request time -- a missing config key must fail loud (a clean 500 via the global
    // exception filter) rather than silently comparing against an empty string, which
    // every empty/missing header would then satisfy. No boot-time check enforces this var
    // is set; an operator who never configures it just gets every report rejected here.
    const expected = this.config.getOrThrow<string>('BACKUP_REPORT_SECRET');

    // A missing header is `undefined`; a duplicated header is a string[] (Express's
    // node:http behavior for repeated headers) -- neither is ever a valid secret, and
    // must be rejected before reaching the hash comparison (createHash().update() would
    // throw on a string[], turning an auth failure into an unrelated 500).
    if (typeof provided !== 'string' || provided.length === 0 || !this.constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const digestA = createHash('sha256').update(a).digest();
    const digestB = createHash('sha256').update(b).digest();
    return timingSafeEqual(digestA, digestB);
  }
}
