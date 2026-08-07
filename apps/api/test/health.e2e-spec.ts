import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { REDIS } from '../src/redis/redis.module';
import { createTestApp } from './utils/test-app';
import { resetDatabase } from './utils/db';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok when the DB and Redis are both reachable', () =>
    request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', db: 'ok', redis: 'ok' }));

  it('GET /api/health returns 503 when the DB is unreachable', async () => {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    const originalQuery = dataSource.query.bind(dataSource);
    jest.spyOn(dataSource, 'query').mockRejectedValueOnce(new Error('connection lost'));

    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body).toEqual({ status: 'error', db: 'error', redis: 'ok' });

    dataSource.query = originalQuery;
  });

  it('GET /api/health returns 503 when Redis is unreachable', async () => {
    const redis = app.get(REDIS);
    jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('connection lost'));

    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body).toEqual({ status: 'error', db: 'ok', redis: 'error' });
  });
});
