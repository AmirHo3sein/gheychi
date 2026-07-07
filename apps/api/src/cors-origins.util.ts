import { ConfigService } from '@nestjs/config';

export function buildAllowedOrigins(config: ConfigService): string[] {
  return [
    config.get('FRONTEND_BASE_URL', 'http://localhost:3003'),
    config.get('PROVIDER_APP_BASE_URL', 'http://localhost:3004'),
  ];
}
