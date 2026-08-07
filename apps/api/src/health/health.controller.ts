import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
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
