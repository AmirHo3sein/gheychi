import { ConfigService } from '@nestjs/config';
import { buildAllowedOrigins } from './cors-origins.util';

describe('buildAllowedOrigins', () => {
  it('defaults to the known user-app and provider-panel dev ports', () => {
    const config = new ConfigService({});
    expect(buildAllowedOrigins(config)).toEqual(['http://localhost:3003', 'http://localhost:3004']);
  });

  it('uses configured env vars when set', () => {
    const config = new ConfigService({
      FRONTEND_BASE_URL: 'https://app.arayeshgah.ir',
      PROVIDER_APP_BASE_URL: 'https://provider.arayeshgah.ir',
    });
    expect(buildAllowedOrigins(config)).toEqual([
      'https://app.arayeshgah.ir',
      'https://provider.arayeshgah.ir',
    ]);
  });
});
