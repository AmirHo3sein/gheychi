import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const nestConfig = app.get(ConfigService);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  // The session cookie is issued with sameSite: 'lax' (see auth.controller.ts), which relies on
  // FRONTEND_BASE_URL staying same-site with this API's own host (e.g. different ports on
  // localhost, or sibling subdomains in production) -- if the frontend ever moves to a genuinely
  // different registrable domain, Lax cookies stop being sent cross-origin and auth silently breaks.
  app.enableCors({
    origin: nestConfig.get('FRONTEND_BASE_URL', 'http://localhost:3003'),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
