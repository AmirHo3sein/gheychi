// Must be the very first import in the process -- see tracing.ts's own doc comment for
// why (OTel auto-instrumentation has to patch 'http'/'pg'/'ioredis' before anything else
// requires them). `reflect-metadata` below has no interaction with any instrumented
// module, so its position relative to this import doesn't matter, but this stays first
// regardless to keep the ordering obviously correct at a glance rather than relying on
// that fact.
import './tracing';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { RequestContextConsoleLogger } from './common/request-context-logger.service';
import { requestLoggingMiddleware } from './common/request-logging.middleware';
import { buildAllowedOrigins } from './cors-origins.util';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // In production this process only ever receives connections from the Caddy reverse
  // proxy container (docker-compose.prod.yml gives it no published port of its own), so the
  // one hop it should trust is exactly right -- without this, Express's req.ip is Caddy's
  // own address for every request, not the real client's. That silently breaks every
  // IP-keyed rate limit in this app (OtpService.issue's per-IP cap, referrals.controller's
  // GET /referrals/validate cap): once behind a real reverse proxy, all real visitors would
  // share one bucket and lock each other out. Local dev has no proxy in front of it, so this
  // is a no-op there (req.ip is already the real, direct connection).
  app.set('trust proxy', 1);
  // Makes every `new Logger(context)` call site app-wide automatically include the
  // current request's id (see request-context-logger.service.ts) -- must be set before
  // any meaningful logging happens, and pairs with requestLoggingMiddleware below,
  // which seeds the AsyncLocalStorage store this logger reads from.
  app.useLogger(new RequestContextConsoleLogger());
  const nestConfig = app.get(ConfigService);
  app.use(requestLoggingMiddleware);
  // A separate, DI-backed middleware (see http-metrics.middleware.ts's own doc
  // comment for why it's not merged into requestLoggingMiddleware above) -- resolved
  // from the app's DI container (MetricsModule is @Global(), so this is reachable
  // even though nothing here imports MetricsModule directly) and registered the same
  // way, before routing, so it can time every request via the same res.on('finish')
  // idiom requestLoggingMiddleware uses.
  const httpMetricsMiddleware = app.get(HttpMetricsMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) => httpMetricsMiddleware.use(req, res, next));
  app.use(cookieParser());
  // Nest's default body parser only binds to `Content-Type: application/json`, but browsers
  // send CSP violation reports (see csp-report/csp-report.controller.ts) as
  // `application/csp-report` (the legacy report-uri mechanism) -- without this, req.body
  // would be undefined for every real violation report and CspReportController would only
  // ever see 'unknown'. Scoped to the one path that needs it, at the final external URL
  // (setGlobalPrefix below doesn't affect raw express-level app.use path matching), rather
  // than loosening body parsing app-wide.
  //
  // MUST be wrapped in a differently-named function, not passed express.json(...)'s return
  // value directly: that return value is always a function literally named `jsonParser`
  // (an internal detail of the `body-parser` package express re-exports), and
  // ExpressAdapter.isMiddlewareApplied() -- which Nest's own registerParserMiddleware() calls
  // later, inside app.listen() -- detects an "already applied" json parser purely by that
  // function name, regardless of path or options. Registering this under the same name here
  // made Nest skip installing its own real, unscoped json parser entirely, silently breaking
  // req.body for every other JSON route in the app (confirmed live: this took down
  // request-otp, and by the same mechanism every other JSON POST/PATCH endpoint, within
  // minutes of deploying -- see git history for the incident this comment is warning about).
  function cspReportJsonParser(req: Request, res: Response, next: NextFunction) {
    return express.json({
      type: ['application/json', 'application/csp-report', 'application/reports+json'],
      limit: '20kb',
    })(req, res, next);
  }
  app.use('/api/csp-report', cspReportJsonParser);
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    // Defense-in-depth alongside the upload-time Content-Type validation (see
    // common/trusted-image-upload.ts): /uploads is the one route that serves
    // potentially attacker-influenced file content straight to a browser, so this stops
    // a browser from ever second-guessing a served file's declared Content-Type via its
    // own content-sniffing heuristics.
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  // The session cookie is issued with sameSite: 'lax' (see auth.controller.ts), which relies on
  // FRONTEND_BASE_URL staying same-site with this API's own host (e.g. different ports on
  // localhost, or sibling subdomains in production) -- if the frontend ever moves to a genuinely
  // different registrable domain, Lax cookies stop being sent cross-origin and auth silently breaks.
  app.enableCors({
    origin: buildAllowedOrigins(nestConfig),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
