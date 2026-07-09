import { DataSource } from 'typeorm';
import { User } from '../src/users/user.entity';
import { createAdmin } from './create-admin';

describe('createAdmin', () => {
  let repo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let dataSource: DataSource;

  beforeEach(() => {
    repo = {
      findOneBy: jest.fn(),
      create: jest.fn((partial: Partial<User>) => partial as User),
      save: jest.fn(async (user: User) => user),
    };
    dataSource = { getRepository: jest.fn().mockReturnValue(repo) } as unknown as DataSource;
  });

  it('rejects an invalid phone without touching the database', async () => {
    await expect(createAdmin(dataSource, '12345')).rejects.toThrow('not a valid Iranian mobile number');
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('creates a brand-new active admin when the phone is unknown', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('created');
    expect(repo.create).toHaveBeenCalledWith({ phone: '09121234567', role: 'admin', status: 'active' });
    expect(repo.save).toHaveBeenCalled();
  });

  it('promotes an existing customer to active admin', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u1', phone: '09121234567', role: 'customer', status: 'active' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('promoted');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', status: 'active' }));
  });

  it('reactivates a suspended admin and reports promoted', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u2', phone: '09121234567', role: 'admin', status: 'suspended' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('promoted');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', status: 'active' }));
  });

  it('is a no-op for an already-active admin', async () => {
    repo.findOneBy.mockResolvedValue({ id: 'u3', phone: '09121234567', role: 'admin', status: 'active' } as User);
    await expect(createAdmin(dataSource, '09121234567')).resolves.toBe('already-admin');
    expect(repo.save).not.toHaveBeenCalled();
  });
});
