import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { AdminSalonsController } from './admin-salons.controller';
import { Salon } from './salon.entity';

describe('AdminSalonsController.setStatus suspended_cause handling', () => {
  let controller: AdminSalonsController;
  let repo: { update: jest.Mock; findOneBy: jest.Mock };
  let users: { findById: jest.Mock };

  beforeEach(() => {
    repo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOneBy: jest.fn().mockResolvedValue({ id: 's1' }),
    };
    users = {
      findById: jest.fn().mockResolvedValue({ id: 'owner-1', status: 'active' }),
    };
    controller = new AdminSalonsController(repo as unknown as Repository<Salon>, users as unknown as UsersService);
  });

  it('records suspended_cause=admin on a direct suspension', async () => {
    await controller.setStatus('s1', { status: 'suspended', reason: 'تخلف از قوانین پلتفرم' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'suspended', rejectionReason: 'تخلف از قوانین پلتفرم', suspendedCause: 'admin' },
    );
  });

  it('clears suspended_cause on approval', async () => {
    await controller.setStatus('s1', { status: 'approved' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'approved', rejectionReason: null, suspendedCause: null },
    );
  });

  it('leaves suspended_cause untouched on rejection', async () => {
    await controller.setStatus('s1', { status: 'rejected', reason: 'مدارک ناقص است' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'rejected', rejectionReason: 'مدارک ناقص است' },
    );
  });

  it('404s when the salon does not exist', async () => {
    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(controller.setStatus('missing', { status: 'approved' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('admin intent wins: a direct suspension overwrites a prior cascade cause of owner_suspended', async () => {
    // Simulates the scenario from Task 14's cascade: the salon is already suspended
    // because its owner was suspended (suspended_cause='owner_suspended'). An admin
    // then suspends it directly for an unrelated reason. The update must be sent
    // unconditionally with suspendedCause: 'admin' -- NOT skipped or merged based on
    // the current value, and NOT read-before-write -- so that reactivating the owner
    // afterward does NOT auto-restore this salon (only the cascade in Task 14 checks
    // for suspended_cause='owner_suspended' before restoring).
    repo.findOneBy.mockResolvedValueOnce({ id: 's1', status: 'suspended', suspendedCause: 'admin' });

    const result = await controller.setStatus('s1', { status: 'suspended', reason: 'تخلف مجدد' });

    // The controller never reads the salon's current suspendedCause before writing --
    // it unconditionally sends 'admin', which is what makes the overwrite guaranteed
    // regardless of whatever the prior cause was.
    expect(repo.findOneBy).not.toHaveBeenCalledWith({ id: 's1', suspendedCause: 'owner_suspended' });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 's1' },
      { status: 'suspended', rejectionReason: 'تخلف مجدد', suspendedCause: 'admin' },
    );
    expect(result).toEqual({ id: 's1', status: 'suspended', suspendedCause: 'admin' });
  });

  it('refuses to approve a pending salon whose owner account is suspended', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: 's1', ownerId: 'owner-1', status: 'pending' });
    users.findById.mockResolvedValueOnce({ id: 'owner-1', status: 'suspended' });

    await expect(controller.setStatus('s1', { status: 'approved' })).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
