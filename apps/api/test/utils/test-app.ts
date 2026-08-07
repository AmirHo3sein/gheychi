import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from '../../src/app.module';

// requestLoggingMiddleware (src/main.ts) is deliberately NOT mirrored here, unlike the
// nosniff/static-assets setup below -- no e2e test asserts on X-Request-Id or the
// access-log line it produces, and logging one line per request across this suite's
// 500+ requests (run --runInBand, sequentially) adds real I/O load for zero test value.
// The middleware itself is covered directly by request-logging.middleware.spec.ts.
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
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
  return app;
}
