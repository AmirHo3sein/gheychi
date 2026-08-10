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

// A full set of in-bounds sample values for every required key -- mirrors the documented
// defaults in docs/technical-overview/20-business-rules.md. Reused by any test that needs a
// "the DB row for this key is present and valid" fixture.
const VALID_CONFIG_VALUES: Record<string, number> = {
  deposit_percent: 20,
  deposit_min_toman: 200_000,
  cancellation_window_hours: 24,
  commission_percent: 10,
  booking_hold_ttl_minutes: 15,
  reminder_lead_hours: 3,
  review_edit_window_hours: 72,
};

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

  // Defense-in-depth mirror of the malformed-value startup check below, for a row that was
  // valid at boot but got overwritten with garbage directly against the database afterwards.
  it('throws a typed NestJS exception with a clear message when the stored value is non-numeric', async () => {
    repo.findOneBy.mockResolvedValue({ key: 'commission_percent', value: 'not-a-number' });

    const attempt = service.getCommissionPercent();

    await expect(attempt).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(attempt).rejects.toThrow(/commission_percent.*not a valid number/);
  });

  // Same defense-in-depth idea, but for a numeric value that's outside the key's sane bounds
  // (e.g. a percent field overwritten with 150) rather than non-numeric outright.
  it('throws a typed NestJS exception with a clear message when the stored value is out of bounds', async () => {
    repo.findOneBy.mockResolvedValue({ key: 'commission_percent', value: 150 });

    const attempt = service.getCommissionPercent();

    await expect(attempt).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(attempt).rejects.toThrow(/commission_percent=150 is out of bounds/);
  });

  it('does not cache a malformed or out-of-bounds value', async () => {
    repo.findOneBy.mockResolvedValue({ key: 'commission_percent', value: 'nope' });

    await expect(service.getCommissionPercent()).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(redis.set).not.toHaveBeenCalled();
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

  it('boots cleanly when every required key is present with a valid, in-bounds value', async () => {
    repoFind.mockResolvedValue(
      REQUIRED_PLATFORM_CONFIG_KEYS.map((key) => ({ key, value: VALID_CONFIG_VALUES[key] })),
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails boot with a clear message naming every missing key when some are absent', async () => {
    // Only 2 of the 7 required rows exist -- simulates a fresh/incomplete seed. The two
    // present rows carry valid values so this test isolates the "missing key" path from the
    // "invalid value" path exercised separately below.
    repoFind.mockResolvedValue([
      { key: 'deposit_percent', value: VALID_CONFIG_VALUES.deposit_percent },
      { key: 'commission_percent', value: VALID_CONFIG_VALUES.commission_percent },
    ]);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Missing required platform_config row\(s\): .*deposit_min_toman/,
    );
  });

  it('fails boot when the platform_config table is completely empty', async () => {
    repoFind.mockResolvedValue([]);

    const attempt = service.onApplicationBootstrap();
    await expect(attempt).rejects.toThrow(new RegExp(REQUIRED_PLATFORM_CONFIG_KEYS.join('.*')));
  });

  it('fails boot with a clear message naming a present key whose value is non-numeric/malformed', async () => {
    repoFind.mockResolvedValue(
      REQUIRED_PLATFORM_CONFIG_KEYS.map((key) =>
        key === 'deposit_percent' ? { key, value: 'twenty' } : { key, value: VALID_CONFIG_VALUES[key] },
      ),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Invalid platform_config value\(s\): deposit_percent="twenty" is not a valid number/,
    );
  });

  it('fails boot with a clear message naming a present key whose value is null', async () => {
    repoFind.mockResolvedValue(
      REQUIRED_PLATFORM_CONFIG_KEYS.map((key) =>
        key === 'booking_hold_ttl_minutes' ? { key, value: null } : { key, value: VALID_CONFIG_VALUES[key] },
      ),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Invalid platform_config value\(s\): booking_hold_ttl_minutes=null is not a valid number/,
    );
  });

  it('fails boot with a clear message naming a present percent-shaped key whose value exceeds 100', async () => {
    repoFind.mockResolvedValue(
      REQUIRED_PLATFORM_CONFIG_KEYS.map((key) =>
        key === 'commission_percent' ? { key, value: 150 } : { key, value: VALID_CONFIG_VALUES[key] },
      ),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Invalid platform_config value\(s\): commission_percent=150 is out of bounds \(expected 0\.\.100\)/,
    );
  });

  it('fails boot with a clear message naming a present non-percent key whose value is negative', async () => {
    repoFind.mockResolvedValue(
      REQUIRED_PLATFORM_CONFIG_KEYS.map((key) =>
        key === 'cancellation_window_hours' ? { key, value: -5 } : { key, value: VALID_CONFIG_VALUES[key] },
      ),
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /Invalid platform_config value\(s\): cancellation_window_hours=-5 is out of bounds \(expected 0\.\.∞\)/,
    );
  });

  it('reports both missing and invalid keys together when both problems exist', async () => {
    repoFind.mockResolvedValue([
      // deposit_min_toman, cancellation_window_hours, booking_hold_ttl_minutes,
      // reminder_lead_hours, review_edit_window_hours are all absent from this list.
      { key: 'deposit_percent', value: VALID_CONFIG_VALUES.deposit_percent },
      { key: 'commission_percent', value: 'garbage' },
    ]);

    const attempt = service.onApplicationBootstrap();
    await expect(attempt).rejects.toThrow(/Missing required platform_config row\(s\): .*deposit_min_toman/);
    await expect(attempt).rejects.toThrow(/Invalid platform_config value\(s\): commission_percent="garbage"/);
  });
});
