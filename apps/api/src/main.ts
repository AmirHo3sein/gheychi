import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { requestLoggingMiddleware } from './common/request-logging.middleware';
import { buildAllowedOrigins } from './cors-origins.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const nestConfig = app.get(ConfigService);
  app.use(requestLoggingMiddleware);
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
