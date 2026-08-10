import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

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
 * appended to a per-request access-log line. The rest of the request -- routing,
 * guards, controller, and every downstream service call it triggers (e.g. a
 * booking creation that also touches payments and notifications) -- runs inside
 * `requestContextStorage.run()`, so `getRequestId()` (and, via
 * `RequestContextConsoleLogger`, every `Logger.log()`/`.error()`/etc. call anywhere
 * in that chain) automatically has this same id available without it being passed
 * as an explicit parameter. See `request-context.ts` and
 * `request-context-logger.service.ts`.
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && TRUSTED_REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    // req.path (not req.originalUrl) -- deliberately excludes the query string, which
    // can carry a genuinely sensitive value verbatim (GET /payments/callback's own
    // ?Authority=...&Status=... from Zarinpal is a real, currently-existing example,
    // not a hypothetical one -- logging it here would print every payment's gateway
    // transaction authority into the access log on every single callback request).
    // Mirrors GlobalExceptionFilter's own req.path choice for the exact same reason --
    // see its doc comment.
    logger.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms [${requestId}]`);
  });

  requestContextStorage.run({ requestId }, next);
}
