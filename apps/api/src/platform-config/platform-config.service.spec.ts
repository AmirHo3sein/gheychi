import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigService, REQUIRED_PLATFORM_CONFIG_KEYS } from './platform-config.service';

describe('PlatformConfigService.set', () => {
  let service: PlatformConfigService;
  let repo: { upsert: jest.Mock; find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    repo = { upsert: jest.fn(), find: jest.fn() };
    dataSource = { transaction: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('upserts the given key/value pair', async () => {
    await service.set('commission_percent', 12);
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'commission_percent', value: 12 }, ['key']);
  });

  it('invalidates the cached value for that key after the write commits', async () => {
    await service.set('commission_percent', 12);
    expect(redis.del).toHaveBeenCalledWith('platform-config:commission_percent');
  });
});

describe('PlatformConfigService.setMany', () => {
  let service: PlatformConfigService;
  let repo: { find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let em: { update: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    em = { update: jest.fn() };
    repo = { find: jest.fn() };
    dataSource = { transaction: jest.fn((cb: (em: unknown) => Promise<unknown>) => cb(em)) };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('throws and writes nothing when a key does not exist', async () => {
    repo.find.mockResolvedValue([{ key: 'commission_percent' }]);

    await expect(
      service.setMany([
        { key: 'commission_percent', value: 12 },
        { key: 'commission_precent', value: 5 },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('updates every entry within a single transaction when all keys exist', async () => {
    repo.find.mockResolvedValue([{ key: 'commission_percent' }, { key: 'deposit_percent' }]);

    await service.setMany([
      { key: 'commission_percent', value: 12 },
      { key: 'deposit_percent', value: 25 },
    ]);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(em.update).toHaveBeenNthCalledWith(1, PlatformConfig, { key: 'commission_percent' }, { value: 12 });
    expect(em.update).toHaveBeenNthCalledWith(2, PlatformConfig, { key: 'deposit_percent' }, { value: 25 });
  });

  it('invalidates the cached value for every updated key after the transaction commits', async () => {
    repo.find.mockResolvedValue([{ key: 'commission_percent' }, { key: 'deposit_percent' }]);

    await service.setMany([
      { key: 'commission_percent', value: 12 },
      { key: 'deposit_percent', value: 25 },
    ]);

    expect(redis.del).toHaveBeenCalledWith('platform-config:commission_percent', 'platform-config:deposit_percent');
  });
});

describe('PlatformConfigService -- getter failure handling', () => {
  let service: PlatformConfigService;
  let repo: { findOneBy: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn() };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: {} },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('resolves the numeric value when the key exists', async () => {
    repo.findOneBy.mockResolvedValue({ key: 'commission_percent', value: '10' });
    await expect(service.getCommissionPercent()).resolves.toBe(10);
  });

  // Should be unreachable in practice -- onApplicationBootstrap (below) refuses to let the
  // process start at all if any required key is missing -- but this is the defense-in-depth
  // path for a row deleted directly against the database after a successful boot.
  it('throws a typed NestJS exception (not a raw Error) with a clear message when a key is missing', async () => {
    repo.findOneBy.mockResolvedValue(null);

    const attempt = service.getDepositPercent();

    await expect(attempt).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(attempt).rejects.toThrow('Missing platform_config key: deposit_percent');
  });
});

describe('PlatformConfigService -- caching', () => {
  let service: PlatformConfigService;
  let repo: { findOneBy: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn() };
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: {} },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('reads through to Postgres on a cache miss and populates the cache with a TTL', async () => {
    redis.get.mockResolvedValue(null);
    repo.findOneBy.mockResolvedValue({ key: 'commission_percent', value: '12' });

    const result = await service.getCommissionPercent();

    expect(result).toBe(12);
    expect(repo.findOneBy).toHaveBeenCalledWith({ key: 'commission_percent' });
    expect(redis.set).toHaveBeenCalledWith('platform-config:commission_percent', '12', 'EX', 60);
  });

  it('serves a cache hit without ever touching Postgres', async () => {
    redis.get.mockResolvedValue('12');

    const result = await service.getCommissionPercent();

    expect(result).toBe(12);
    expect(repo.findOneBy).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('caches each key under its own namespaced entry', async () => {
    redis.get.mockResolvedValue(null);
    repo.findOneBy.mockResolvedValue({ key: 'deposit_percent', value: '25' });

    await service.getDepositPercent();

    expect(redis.get).toHaveBeenCalledWith('platform-config:deposit_percent');
  });

  it('still throws InternalServerErrorException on a cache miss for a genuinely missing key, without caching anything', async () => {
    redis.get.mockResolvedValue(null);
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.getDepositPercent()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('PlatformConfigService.onApplicationBootstrap -- startup validation', () => {
  let service: PlatformConfigService;
  let repoFind: jest.Mock;

  beforeEach(async () => {
    repoFind = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: { find: repoFind } },
        { provide: DataSource, useValue: {} },
        { provide: REDIS, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('boots cleanly when every required key is present', async () => {
    repoFind.mockResolvedValue(REQUIRED_PLATFORM_CONFIG_KEYS.map((key) => ({ key })));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails boot with a clear message naming every missing key when some are absent', async () => {
    // Only 2 of the 7 required rows exist -- simulates a fresh/incomplete seed.
    repoFind.mockResolvedValue([{ key: 'deposit_percent' }, { key: 'commission_percent' }]);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Missing required platform_config row\(s\): .*deposit_min_toman/,
    );
  });

  it('fails boot when the platform_config table is completely empty', async () => {
    repoFind.mockResolvedValue([]);

    const attempt = service.onApplicationBootstrap();
    await expect(attempt).rejects.toThrow(new RegExp(REQUIRED_PLATFORM_CONFIG_KEYS.join('.*')));
  });
});
