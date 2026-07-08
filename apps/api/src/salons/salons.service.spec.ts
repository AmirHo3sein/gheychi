import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../users/users.service';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService.updateMine', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn(), save: jest.fn((s) => s) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: getRepositoryToken(Salon), useValue: repo },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  it('applies a genderTarget change', async () => {
    repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', genderTarget: 'women' } as Salon);
    const result = await service.updateMine('u1', { genderTarget: 'men' });
    expect(result.genderTarget).toBe('men');
  });
});
