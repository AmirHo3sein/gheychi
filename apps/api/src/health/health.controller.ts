import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Controller()
@Public()
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Kept at its original path/response shape for backward compatibility: CI's Postgres/Redis
  // service containers use their own pg_isready/redis-cli health checks (not this endpoint),
  // but all three apps' playwright.config.ts webServer entries poll GET /api/health as their
  // "the API is ready to spin up the rest of the e2e stack" gate. It intentionally behaves
  // the same as /api/readiness (see below) -- it predates the liveness/readiness split and is
  // preserved as-is rather than folded away, since external tooling already depends on it.
  @Get('health')
  async check() {
    return this.checkDependencies();
  }

  // Liveness: answers "is this process itself alive and able to respond at all?" only.
  // Deliberately does NOT touch the DB or Redis -- an orchestrator (k8s, ECS, etc.) killing
  // and restarting a perfectly healthy API process just because Postgres or Redis had a
  // brief blip is exactly the failure mode a liveness probe must not cause. If this handler
  // can run at all, the process is alive; that's the entire contract.
  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  // Readiness: answers "is this instance ready to receive real traffic?" It SHOULD fail
  // when a critical dependency (DB, Redis) is unreachable, since the API genuinely can't
  // serve most requests without them -- same checks as /api/health, exposed under its own
  // name so callers can depend on the readiness semantics explicitly rather than on
  // /api/health's now-incidental behavior.
  @Get('readiness')
  async readiness() {
    return this.checkDependencies();
  }

  private async checkDependencies() {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    if (db !== 'ok' || redis !== 'ok') {
      throw new ServiceUnavailableException({ status: 'error', db, redis });
    }
    return { status: 'ok', db, redis };
  }

  private async checkDb(): Promise<'ok' | 'error'> {
    try {
      await withTimeout(this.dataSource.query('SELECT 1'), CHECK_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<'ok' | 'error'> {
    try {
      await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return 'ok';
    } catch {
      return 'error';
    }
  }
}
