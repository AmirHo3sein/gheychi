import { ConfigService } from '@nestjs/config';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

describe('VersionController', () => {
  it('GET /version returns the service-reported deploy identity as-is', () => {
    const configValues: Record<string, unknown> = {
      APP_VERSION: '1.4.2',
      GIT_SHA: 'abc1234',
      BUILD_TIMESTAMP: '2026-08-12T00:00:00.000Z',
    };
    const config = { get: (key: string, def?: unknown) => (key in configValues ? configValues[key] : def) } as ConfigService;
    const controller = new VersionController(new VersionService(config));

    expect(controller.getVersion()).toEqual({
      version: '1.4.2',
      gitSha: 'abc1234',
      buildTimestamp: '2026-08-12T00:00:00.000Z',
      environment: process.env.NODE_ENV ?? 'development',
    });
  });

  it('GET /version falls back to dev defaults when no CI/CD env vars are set', () => {
    const config = { get: (_key: string, def?: unknown) => def } as ConfigService;
    const controller = new VersionController(new VersionService(config));

    expect(controller.getVersion()).toEqual({
      version: 'dev',
      gitSha: 'unknown',
      buildTimestamp: null,
      environment: process.env.NODE_ENV ?? 'development',
    });
  });
});
