import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from '../../src/app.module';

// requestLoggingMiddleware (src/main.ts) is deliberately NOT mirrored here, unlike the
// nosniff/static-assets setup below -- no e2e test asserts on X-Request-Id or the
// access-log line it produces, and logging one line per request across this suite's
// 500+ requests (run --runInBand, sequentially) adds real I/O load for zero test value.
// The middleware itself is covered directly by request-logging.middleware.spec.ts.
//
// Everything below THIS point, though, mirrors main.ts's real bootstrap deliberately, not
// just where convenient -- see body-parser-registration.e2e-spec.ts for exactly why: a
// past drift here (this file not mirroring a body-parser registration main.ts added) let a
// real bug reach production undetected, because this hand-maintained reimplementation is
// the ONLY bootstrap path any Jest e2e test ever exercises (main.ts's own bootstrap() is
// never called in tests). If you add anything to main.ts that touches app.use()/body
// parsing/global pipes, mirror it here too, in the same order.
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
  // See main.ts's own doc comment on this exact line for why it MUST be wrapped in a
  // differently-named function rather than passed express.json(...)'s return value
  // directly -- passing it directly is exactly the bug this mirrored copy exists to catch.
  // See main.ts's own doc comment on this exact line for why it MUST be wrapped in a
  // differently-named function rather than passed express.json(...)'s return value
  // directly -- passing it directly is exactly the bug this mirrored copy exists to catch.
  function cspReportJsonParser(req: Request, res: Response, next: NextFunction) {
    return express.json({
      type: ['application/json', 'application/csp-report', 'application/reports+json'],
      limit: '20kb',
    })(req, res, next);
  }
  app.use('/api/csp-report', cspReportJsonParser);
  // Mirrors src/main.ts's real bootstrap (including the nosniff header) rather than a
  // parallel, drifting reimplementation -- otherwise nothing in the e2e suite ever
  // actually exercises static file serving at all, despite several upload tests
  // asserting a response body contains an "/uploads/" URL.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.init();
  // Start a single real listener up front rather than letting supertest manage one.
  // Without this, supertest's own `Test` class (see its `.end()`) opens an ephemeral
  // `http.Server` per request via `app.listen(0)` and closes it once that request
  // settles -- fine for a lone sequential request, but under `Promise.all` (e.g. this
  // suite's own concurrency tests) the first request to finish closes the shared
  // server out from under any siblings still in flight, surfacing as a spurious
  // ECONNRESET. Listening here means `app.getHttpServer()` is already an open server
  // by the time supertest sees it, so it reuses that connection instead of owning the
  // server's lifecycle -- `app.close()` in each spec's `afterAll` still tears it down.
  await app.listen(0);
  return app;
}
