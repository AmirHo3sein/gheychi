import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

/**
 * Pure so the password-omission behavior is unit-testable without a real ioredis
 * connection -- see redis.module.spec.ts.
 *
 * Blank/unset REDIS_PASSWORD (local dev and test: docker-compose.yml's redis has no
 * --requirepass) resolves to `undefined`, and ioredis sends no AUTH command at all when
 * the option is undefined -- that is not a security compromise for those environments.
 * Production sets REDIS_PASSWORD and docker-compose.prod.yml's redis service requires it
 * via --requirepass; see that file's own comment on the blast radius this closes (a
 * compromised sibling container on the internal network could otherwise read live OTP
 * codes -- a full account-takeover primitive -- or delete cron/booking locks).
 */
export function buildRedisOptions(config: Pick<ConfigService, 'get'>): RedisOptions {
  return {
    host: config.get('REDIS_HOST', 'localhost'),
    port: +config.get('REDIS_PORT', 6379),
    password: config.get('REDIS_PASSWORD', '') || undefined,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis(buildRedisOptions(config)),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
