import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

// Same shape used by salon-workers.controller.spec.ts / content.service.spec.ts: a TypeORM
// QueryFailedError carrying the pg driver's code, which isUniqueViolation() reads.
function uniqueViolation(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
  return new QueryFailedError('INSERT INTO users', [], driverError);
}

describe('UsersService.findOrCreateByPhone', () => {
  let service: UsersService;
  let findOneBy: jest.Mock;
  let save: jest.Mock;

  beforeEach(async () => {
    findOneBy = jest.fn();
    save = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: { findOneBy, save, create: (obj: unknown) => obj },
        },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  it('returns the existing user without inserting when the phone is already on record', async () => {
    findOneBy.mockResolvedValue({ id: 'user-1', phone: '09120000000' });

    const result = await service.findOrCreateByPhone('09120000000');

    expect(result).toEqual({ user: { id: 'user-1', phone: '09120000000' }, isNew: false });
    expect(save).not.toHaveBeenCalled();
  });

  it('creates a new user when the phone has never been seen', async () => {
    findOneBy.mockResolvedValue(null);
    save.mockResolvedValue({ id: 'user-2', phone: '09121234567' });

    const result = await service.findOrCreateByPhone('09121234567');

    expect(result).toEqual({ user: { id: 'user-2', phone: '09121234567' }, isNew: true });
  });

  it('re-reads and returns the winner instead of throwing when a concurrent call already inserted the same phone', async () => {
    // First read sees nothing yet (this call lost the race); the insert then hits the
    // DB-unique constraint a concurrent caller's insert just satisfied.
    findOneBy.mockResolvedValueOnce(null);
    save.mockRejectedValue(uniqueViolation());
    findOneBy.mockResolvedValueOnce({ id: 'user-3', phone: '09123330000' });

    const result = await service.findOrCreateByPhone('09123330000');

    expect(result).toEqual({ user: { id: 'user-3', phone: '09123330000' }, isNew: false });
  });

  it('still propagates a non-unique-violation error from the insert', async () => {
    findOneBy.mockResolvedValueOnce(null);
    save.mockRejectedValue(new Error('connection reset'));

    await expect(service.findOrCreateByPhone('09124440000')).rejects.toThrow('connection reset');
  });
});
