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
import { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { RequestContextConsoleLogger } from './common/request-context-logger.service';
import { requestLoggingMiddleware } from './common/request-logging.middleware';
import { buildAllowedOrigins } from './cors-origins.util';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
