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

  describe('GET /api/health', () => {
    it('returns ok when the DB and Redis are both reachable', () =>
      request(app.getHttpServer())
        .get('/api/health')
        .expect(200)
        .expect({ status: 'ok', db: 'ok', redis: 'ok' }));

    it('returns 503 when the DB is unreachable', async () => {
      const dataSource = app.get<DataSource>(getDataSourceToken());
      const originalQuery = dataSource.query.bind(dataSource);
      jest.spyOn(dataSource, 'query').mockRejectedValueOnce(new Error('connection lost'));

      const res = await request(app.getHttpServer()).get('/api/health').expect(503);
      expect(res.body).toEqual({ status: 'error', db: 'error', redis: 'ok' });

      dataSource.query = originalQuery;
    });

    it('returns 503 when Redis is unreachable', async () => {
      const redis = app.get(REDIS);
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('connection lost'));

      const res = await request(app.getHttpServer()).get('/api/health').expect(503);
      expect(res.body).toEqual({ status: 'error', db: 'ok', redis: 'error' });
    });
  });

  describe('GET /api/liveness', () => {
    it('returns ok when everything is healthy', () =>
      request(app.getHttpServer()).get('/api/liveness').expect(200).expect({ status: 'ok' }));

    it('still returns ok when the DB is unreachable (liveness must not depend on the DB)', async () => {
      const dataSource = app.get<DataSource>(getDataSourceToken());
      const originalQuery = dataSource.query.bind(dataSource);
      jest.spyOn(dataSource, 'query').mockRejectedValueOnce(new Error('connection lost'));

      await request(app.getHttpServer())
        .get('/api/liveness')
        .expect(200)
        .expect({ status: 'ok' });

      dataSource.query = originalQuery;
    });

    it('still returns ok when Redis is unreachable (liveness must not depend on Redis)', async () => {
      const redis = app.get(REDIS);
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('connection lost'));

      await request(app.getHttpServer())
        .get('/api/liveness')
        .expect(200)
        .expect({ status: 'ok' });
    });
  });

  describe('GET /api/readiness', () => {
    it('returns ok when the DB and Redis are both reachable', () =>
      request(app.getHttpServer())
        .get('/api/readiness')
        .expect(200)
        .expect({ status: 'ok', db: 'ok', redis: 'ok' }));

    it('returns 503 when the DB is unreachable', async () => {
      const dataSource = app.get<DataSource>(getDataSourceToken());
      const originalQuery = dataSource.query.bind(dataSource);
      jest.spyOn(dataSource, 'query').mockRejectedValueOnce(new Error('connection lost'));

      const res = await request(app.getHttpServer()).get('/api/readiness').expect(503);
      expect(res.body).toEqual({ status: 'error', db: 'error', redis: 'ok' });

      dataSource.query = originalQuery;
    });

    it('returns 503 when Redis is unreachable', async () => {
      const redis = app.get(REDIS);
      jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('connection lost'));

      const res = await request(app.getHttpServer()).get('/api/readiness').expect(503);
      expect(res.body).toEqual({ status: 'error', db: 'ok', redis: 'error' });
    });
  });
});
