import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

// Bounded, safe-charset check on an incoming client/proxy-supplied id before it's
// echoed back in a response header and interpolated into log lines -- an
// unvalidated value could smuggle control characters (log/header injection) or be
// arbitrarily large.
const TRUSTED_REQUEST_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

/**
 * Ties one request's log lines together via a single id (generated here, or
 * reused from an incoming X-Request-Id set by a fronting proxy/load balancer),
 * echoed back on the response so a client/support ticket can reference it, and
 * appended to a per-request access-log line -- the only cross-cutting log
 * correlation this app has today (see CLAUDE.md's "no global exception filter"
 * choice; NestJS's own default logger still covers uncaught-exception stacks).
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && TRUSTED_REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms [${requestId}]`);
  });

  next();
}
