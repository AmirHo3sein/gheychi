import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VersionService } from './version.service';

describe('VersionService', () => {
  async function build(configValues: Record<string, unknown>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VersionService,
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: unknown) => (key in configValues ? configValues[key] : def) },
        },
      ],
    }).compile();
    return moduleRef.get(VersionService);
  }

  it('returns the configured version, git SHA, and build timestamp', async () => {
    const service = await build({
      APP_VERSION: '1.4.2',
      GIT_SHA: 'abc1234',
      BUILD_TIMESTAMP: '2026-08-12T00:00:00.000Z',
    });

    expect(service.getInfo()).toEqual({
      version: '1.4.2',
      gitSha: 'abc1234',
      buildTimestamp: '2026-08-12T00:00:00.000Z',
      environment: process.env.NODE_ENV ?? 'development',
    });
  });

  it('falls back to dev-friendly defaults when the CI/CD-set env vars are absent (local dev)', async () => {
    const service = await build({});

    expect(service.getInfo()).toEqual({
      version: 'dev',
      gitSha: 'unknown',
      buildTimestamp: null,
      environment: process.env.NODE_ENV ?? 'development',
    });
  });

  it('reads config once at construction time, not per call (a running process build identity never changes)', async () => {
    const configValues: Record<string, unknown> = { APP_VERSION: '1.0.0' };
    const service = await build(configValues);

    configValues.APP_VERSION = '2.0.0';

    expect(service.getInfo().version).toBe('1.0.0');
  });
});
