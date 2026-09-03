import { ConfigService } from '@nestjs/config';
import { buildRedisOptions } from './redis.module';

describe('buildRedisOptions', () => {
  const build = (env: Record<string, string | undefined>) =>
    buildRedisOptions({
      get: (key: string, fallback?: unknown) => env[key] ?? fallback,
    } as unknown as ConfigService);

  it('defaults to localhost:6379 with no password when nothing is set (local dev)', () => {
    expect(build({})).toEqual({ host: 'localhost', port: 6379, password: undefined });
  });

  it('reads REDIS_HOST/REDIS_PORT and coerces the port to a number', () => {
    expect(build({ REDIS_HOST: 'redis', REDIS_PORT: '6381' })).toMatchObject({ host: 'redis', port: 6381 });
  });

  it('sends no password when REDIS_PASSWORD is unset -- ioredis skips AUTH entirely for undefined', () => {
    expect(build({ REDIS_HOST: 'redis' }).password).toBeUndefined();
  });

  it('sends no password when REDIS_PASSWORD is explicitly blank', () => {
    expect(build({ REDIS_PASSWORD: '' }).password).toBeUndefined();
  });

  it('passes a real REDIS_PASSWORD through', () => {
    expect(build({ REDIS_PASSWORD: 'super-secret' }).password).toBe('super-secret');
  });
});
