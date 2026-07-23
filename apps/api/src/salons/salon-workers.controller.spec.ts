import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { QueryFailedError, Repository } from 'typeorm';
import { ReferralsService } from '../referrals/referrals.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { SalonWorkersController } from './salon-workers.controller';
import { Worker } from './worker.entity';

// Same shape used by content.service.spec.ts / reports.service.spec.ts: a TypeORM
// QueryFailedError carrying the pg driver's code, which isUniqueViolation() reads.
function uniqueViolation(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
  return new QueryFailedError('INSERT INTO workers', [], driverError);
}

describe('SalonWorkersController', () => {
  let controller: SalonWorkersController;
  let workers: { save: jest.Mock; create: jest.Mock; find: jest.Mock; findOneBy: jest.Mock };
  let usersService: { findOrCreateByPhone: jest.Mock };
  let referralsService: { getOrCreateMyCode: jest.Mock };
  const OWNER_REQ = { salonId: 'salon-1', user: { id: 'owner-1' } as User } as unknown as Request;

  beforeEach(() => {
    workers = {
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      create: jest.fn().mockImplementation((v) => v),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    usersService = { findOrCreateByPhone: jest.fn() };
    referralsService = { getOrCreateMyCode: jest.fn() };
    controller = new SalonWorkersController(
      workers as unknown as Repository<Worker>,
      usersService as unknown as UsersService,
      referralsService as unknown as ReferralsService,
    );
  });

  describe('create', () => {
    it('rejects a salon owner adding themselves as a worker', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({ user: { id: 'owner-1' }, isNew: false });

      await expect(
        controller.create(OWNER_REQ, { name: 'Self', phone: '09120000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(workers.save).not.toHaveBeenCalled();
    });

    it('creates a worker row scoped to the caller salon for a distinct phone/user', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({ user: { id: 'worker-user-1' }, isNew: true });

      await controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' });

      expect(workers.create).toHaveBeenCalledWith({ salonId: 'salon-1', userId: 'worker-user-1', name: 'Sara' });
      expect(workers.save).toHaveBeenCalled();
    });

    it('translates a unique-violation on (salon_id, user_id) into a 409', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({ user: { id: 'worker-user-1' }, isNew: false });
      workers.save.mockRejectedValue(uniqueViolation());

      const attempt = controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' });
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toMatchObject({ message: 'این کاربر از قبل عضو تیم است' });
    });

    it('lets a genuinely different error propagate unchanged', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({ user: { id: 'worker-user-1' }, isNew: false });
      workers.save.mockRejectedValue(new Error('db down'));

      await expect(controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' })).rejects.toThrow('db down');
    });
  });

  describe('list', () => {
    it('lists both active and inactive workers for the caller salon, newest first', async () => {
      await controller.list(OWNER_REQ);
      expect(workers.find).toHaveBeenCalledWith({ where: { salonId: 'salon-1' }, order: { createdAt: 'DESC' } });
    });
  });

  describe('update', () => {
    it('404s for a worker belonging to a different salon (cross-salon isolation)', async () => {
      workers.findOneBy.mockResolvedValue(null);

      await expect(controller.update(OWNER_REQ, 'worker-9', { active: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(workers.save).not.toHaveBeenCalled();
    });

    it('updates name/active for a worker owned by the caller salon', async () => {
      workers.findOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', name: 'Old', active: true });

      const saved = await controller.update(OWNER_REQ, 'worker-1', { active: false });

      expect(saved.active).toBe(false);
      expect(workers.save).toHaveBeenCalled();
    });
  });

  describe('referralCode', () => {
    it('404s for a worker belonging to a different salon', async () => {
      workers.findOneBy.mockResolvedValue(null);

      await expect(controller.referralCode(OWNER_REQ, 'worker-9')).rejects.toBeInstanceOf(NotFoundException);
      expect(referralsService.getOrCreateMyCode).not.toHaveBeenCalled();
    });

    it("relays the worker's own lifetime referral code", async () => {
      workers.findOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', userId: 'worker-user-1' });
      referralsService.getOrCreateMyCode.mockResolvedValue({ code: 'ABC12345', isActive: true, shareUrl: 'http://x/y' });

      const result = await controller.referralCode(OWNER_REQ, 'worker-1');

      expect(referralsService.getOrCreateMyCode).toHaveBeenCalledWith('worker-user-1');
      expect(result).toEqual({ code: 'ABC12345', isActive: true, shareUrl: 'http://x/y' });
    });
  });
});
