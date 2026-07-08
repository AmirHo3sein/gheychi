import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigService } from './platform-config.service';

describe('PlatformConfigService.set', () => {
  let service: PlatformConfigService;
  let repo: { upsert: jest.Mock };

  beforeEach(async () => {
    repo = { upsert: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [PlatformConfigService, { provide: getRepositoryToken(PlatformConfig), useValue: repo }],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('upserts the given key/value pair', async () => {
    await service.set('commission_percent', 12);
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'commission_percent', value: 12 }, ['key']);
  });
});
