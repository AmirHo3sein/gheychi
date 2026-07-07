import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { buildAllowedOrigins } from './cors-origins.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const nestConfig = app.get(ConfigService);
  app.use(cookieParser());
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
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
