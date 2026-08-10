import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

// Bounded fallback label for any request that never matched a registered Nest route
// (a 404, a typo'd path, a bot scanning for something that isn't there). Falling back
// to the raw req.path instead would reopen the exact unbounded-cardinality trap the
// route-PATTERN choice below exists to avoid -- an attacker/prober can generate an
// unlimited number of distinct nonexistent paths, each becoming its own timeseries.
const UNMATCHED_ROUTE_LABEL = 'unmatched_route';

/**
 * Tracks request count, response status, latency, route, and method for every request
 * this process handles. Mirrors requestLoggingMiddleware's own res.on('finish') timing
 * idiom (see that file) -- deliberately its OWN file/class rather than merged into it:
 * that file's job is a human-readable access log line per request, this one's is a
 * machine-scraped Prometheus counter/histogram, and conflating the two would only make
 * both harder to reason about. Registered as its own app.use() call in main.ts,
 * alongside (not inside) requestLoggingMiddleware's own registration.
 *
 * The `route` label is read as req.route?.path at 'finish' time, NOT req.path/
 * req.originalUrl -- by 'finish' time Nest's router has already matched and attached
 * the route, so this reports the PATTERN (e.g. '/api/salons/:slug'), never the literal
 * path with a real id/slug/uuid baked in. A label keyed on the literal path would mint
 * a brand-new timeseries for every distinct id ever requested -- unbounded cardinality
 * that would eventually make this endpoint too large for Prometheus to scrape.
 * UNMATCHED_ROUTE_LABEL (see above) keeps the no-route-matched case bounded the same
 * way.
 *
 * Best-effort by construction: everything here runs inside the 'finish' handler, which
 * fires after the real response has already been sent to the client, so nothing here
 * can add latency to (or fail) the request it's instrumenting. The try/catch is extra
 * insurance on top of that -- MetricsService's own methods already never throw.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const route = req.route?.path ?? UNMATCHED_ROUTE_LABEL;
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        this.metrics.observeHttpRequest(req.method, route, res.statusCode, durationSeconds);
      } catch {
        // Metrics must never be able to affect a real request -- see class doc.
      }
    });
    next();
  }
}
