import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Salon } from '../salons/salon.entity';
import { AdminUsersService } from './admin-users.service';
import { User } from './user.entity';

describe('AdminUsersService.setStatus', () => {
  let service: AdminUsersService;
  let em: { update: jest.Mock; findOneBy: jest.Mock };
  let transaction: jest.Mock;

  beforeEach(async () => {
    em = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 'target-1', status: 'suspended' }),
    };
    // dataSource.transaction(cb) -> cb(fake EntityManager), so the service's writes
    // are observable while still proving they all go through the one transaction.
    transaction = jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb(em));
    const moduleRef = await Test.createTestingModule({
      providers: [AdminUsersService, { provide: DataSource, useValue: { transaction } }],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it('rejects an admin targeting their own account before opening a transaction', async () => {
    await expect(service.setStatus('admin-1', 'admin-1', 'suspended')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  // The admin panel toasts this message verbatim into a fully Persian RTL screen. The UI
  // also hides the control on the acting admin's own row, but this stays the backstop.
  it('rejects it with a Persian message', async () => {
    await expect(service.setStatus('admin-1', 'admin-1', 'suspended')).rejects.toThrow(
      'تغییر وضعیت حساب خودتان امکان‌پذیر نیست',
    );
  });

  it('404s when the target user does not exist', async () => {
    em.update.mockResolvedValueOnce({ affected: 0 });
    await expect(service.setStatus('admin-1', 'missing-1', 'suspended')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('suspend cascades only onto an APPROVED salon, recording owner_suspended as the cause', async () => {
    await service.setStatus('admin-1', 'target-1', 'suspended');

    expect(em.update).toHaveBeenNthCalledWith(1, User, { id: 'target-1' }, { status: 'suspended' });
    // WHERE owner_id = :id AND status = 'approved' -- pending/rejected/already-suspended
    // salons are untouched (they are not publicly visible anyway).
    expect(em.update).toHaveBeenNthCalledWith(
      2,
      Salon,
      { ownerId: 'target-1', status: 'approved' },
      { status: 'suspended', suspendedCause: 'owner_suspended' },
    );
    expect(em.update).toHaveBeenCalledTimes(2);
  });

  it('reactivate restores ONLY a salon the cascade itself suspended', async () => {
    await service.setStatus('admin-1', 'target-1', 'active');

    expect(em.update).toHaveBeenNthCalledWith(1, User, { id: 'target-1' }, { status: 'active' });
    // WHERE ... AND suspended_cause = 'owner_suspended' -- a salon suspended directly by
    // an admin (suspended_cause='admin') does NOT match and stays suspended.
    expect(em.update).toHaveBeenNthCalledWith(
      2,
      Salon,
      { ownerId: 'target-1', status: 'suspended', suspendedCause: 'owner_suspended' },
      { status: 'approved', suspendedCause: null },
    );
    expect(em.update).toHaveBeenCalledTimes(2);
  });

  it('returns the reloaded user from inside the transaction', async () => {
    const result = await service.setStatus('admin-1', 'target-1', 'suspended');
    expect(em.findOneBy).toHaveBeenCalledWith(User, { id: 'target-1' });
    expect(result).toEqual({ id: 'target-1', status: 'suspended' });
  });
});
