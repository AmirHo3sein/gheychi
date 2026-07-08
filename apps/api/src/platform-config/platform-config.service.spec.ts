import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigService } from './platform-config.service';

describe('PlatformConfigService.set', () => {
  let service: PlatformConfigService;
  let repo: { upsert: jest.Mock; find: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    repo = { upsert: jest.fn(), find: jest.fn() };
    dataSource = { transaction: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('upserts the given key/value pair', async () => {
    await service.set('commission_percent', 12);
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'commission_percent', value: 12 }, ['key']);
  });
});

describe('PlatformConfigService.setMany', () => {
  let service: PlatformConfigService;
  let repo: { find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let em: { update: jest.Mock };

  beforeEach(async () => {
    em = { update: jest.fn() };
    repo = { find: jest.fn() };
    dataSource = { transaction: jest.fn((cb: (em: unknown) => Promise<unknown>) => cb(em)) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformConfigService,
        { provide: getRepositoryToken(PlatformConfig), useValue: repo },
        { provide: DataSource, useValue: dataSource },
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
});
