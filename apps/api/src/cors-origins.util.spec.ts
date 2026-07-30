import { ConfigService } from '@nestjs/config';
import { buildAllowedOrigins } from './cors-origins.util';

describe('buildAllowedOrigins', () => {
  it('defaults to the known user-app, provider-panel, and admin-panel dev ports', () => {
    const config = new ConfigService({});
    expect(buildAllowedOrigins(config)).toEqual([
      'http://localhost:3003',
      'http://localhost:3004',
      'http://localhost:3005',
    ]);
  });

  it('uses configured env vars when set', () => {
    const config = new ConfigService({
      FRONTEND_BASE_URL: 'https://app.gheychi.ir',
      PROVIDER_APP_BASE_URL: 'https://provider.gheychi.ir',
      ADMIN_APP_BASE_URL: 'https://admin.gheychi.ir',
    });
    expect(buildAllowedOrigins(config)).toEqual([
      'https://app.gheychi.ir',
      'https://provider.gheychi.ir',
      'https://admin.gheychi.ir',
    ]);
  });
});
