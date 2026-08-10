import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSourceQuery: jest.Mock;
  let redisPing: jest.Mock;

  beforeEach(async () => {
    dataSourceQuery = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    redisPing = jest.fn().mockResolvedValue('PONG');

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: { query: dataSourceQuery } },
        { provide: REDIS, useValue: { ping: redisPing } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('check (GET /health)', () => {
    it('returns ok for both dependencies when the DB and Redis both respond', async () => {
      await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
    });

    it('throws 503 with db=error when the DB query rejects', async () => {
      dataSourceQuery.mockRejectedValue(new Error('connection refused'));

      await expect(controller.check()).rejects.toMatchObject({
        status: 503,
        response: { status: 'error', db: 'error', redis: 'ok' },
      });
    });

    it('throws 503 with redis=error when the Redis ping rejects', async () => {
      redisPing.mockRejectedValue(new Error('connection refused'));

      await expect(controller.check()).rejects.toMatchObject({
        status: 503,
        response: { status: 'error', db: 'ok', redis: 'error' },
      });
    });

    it('throws 503 with db=error when the DB query hangs past the check timeout', async () => {
      jest.useFakeTimers();
      dataSourceQuery.mockReturnValue(new Promise(() => {})); // never resolves

      const resultPromise = controller.check().catch((err) => err);
      await jest.advanceTimersByTimeAsync(2000);
      const err = await resultPromise;

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.response).toEqual({ status: 'error', db: 'error', redis: 'ok' });
      jest.useRealTimers();
    });
  });

  describe('liveness (GET /liveness)', () => {
    it('returns ok without touching the DB or Redis', () => {
      expect(controller.liveness()).toEqual({ status: 'ok' });
      expect(dataSourceQuery).not.toHaveBeenCalled();
      expect(redisPing).not.toHaveBeenCalled();
    });

    it('stays ok even when the DB and Redis are both failing', () => {
      dataSourceQuery.mockRejectedValue(new Error('connection refused'));
      redisPing.mockRejectedValue(new Error('connection refused'));

      expect(controller.liveness()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness (GET /readiness)', () => {
    it('returns ok for both dependencies when the DB and Redis both respond', async () => {
      await expect(controller.readiness()).resolves.toEqual({
        status: 'ok',
        db: 'ok',
        redis: 'ok',
      });
    });

    it('throws 503 with db=error when the DB query rejects', async () => {
      dataSourceQuery.mockRejectedValue(new Error('connection refused'));

      await expect(controller.readiness()).rejects.toMatchObject({
        status: 503,
        response: { status: 'error', db: 'error', redis: 'ok' },
      });
    });

    it('throws 503 with redis=error when the Redis ping rejects', async () => {
      redisPing.mockRejectedValue(new Error('connection refused'));

      await expect(controller.readiness()).rejects.toMatchObject({
        status: 503,
        response: { status: 'error', db: 'ok', redis: 'error' },
      });
    });
  });
});
