import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ReferralsService } from '../referrals/referrals.service';
import { SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Salon } from './salon.entity';
import { SalonService } from './salon-service.entity';
import { SalonWorkersController } from './salon-workers.controller';
import { Worker } from './worker.entity';
import { WorkerService } from './worker-service.entity';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Same shape used by content.service.spec.ts / reports.service.spec.ts: a TypeORM
// QueryFailedError carrying the pg driver's code, which isUniqueViolation() reads.
function uniqueViolation(): QueryFailedError {
  const driverError = Object.assign(new Error('duplicate key'), { code: '23505' });
  return new QueryFailedError('INSERT INTO workers', [], driverError);
}

describe('SalonWorkersController', () => {
  let controller: SalonWorkersController;
  let workers: { save: jest.Mock; create: jest.Mock; find: jest.Mock; findOneBy: jest.Mock };
  let workerServices: { find: jest.Mock };
  let salonServices: { count: jest.Mock };
  let salons: { findOneBy: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let usersService: { findOrCreateByPhone: jest.Mock };
  let referralsService: { getOrCreateMyCode: jest.Mock };
  let sms: { send: jest.Mock };
  let config: { get: jest.Mock };
  const OWNER_REQ = { salonId: 'salon-1', user: { id: 'owner-1' } as User } as unknown as Request;

  beforeEach(() => {
    workers = {
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      create: jest.fn().mockImplementation((v) => v),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    workerServices = { find: jest.fn().mockResolvedValue([]) };
    salonServices = { count: jest.fn().mockResolvedValue(0) };
    salons = { findOneBy: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'سالن تست' }) };
    dataSource = { transaction: jest.fn().mockImplementation((fn) => fn({ delete: jest.fn(), insert: jest.fn() })) };
    usersService = { findOrCreateByPhone: jest.fn() };
    referralsService = { getOrCreateMyCode: jest.fn() };
    sms = { send: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('http://localhost:3003') };
    controller = new SalonWorkersController(
      workers as unknown as Repository<Worker>,
      workerServices as unknown as Repository<WorkerService>,
      salonServices as unknown as Repository<SalonService>,
      salons as unknown as Repository<Salon>,
      dataSource as unknown as DataSource,
      usersService as unknown as UsersService,
      referralsService as unknown as ReferralsService,
      sms as unknown as SmsProvider,
      config as unknown as ConfigService,
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
      usersService.findOrCreateByPhone.mockResolvedValue({
        user: { id: 'worker-user-1', phone: '09121234567' },
        isNew: true,
      });

      await controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' });

      expect(workers.create).toHaveBeenCalledWith({ salonId: 'salon-1', userId: 'worker-user-1', name: 'Sara' });
      expect(workers.save).toHaveBeenCalled();
    });

    it('SMS-notifies the worker they were added, naming the salon and a login link -- fire-and-forget, never blocking the response', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({
        user: { id: 'worker-user-1', phone: '09121234567' },
        isNew: true,
      });

      await controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' });
      await flush();

      expect(sms.send).toHaveBeenCalledWith('09121234567', expect.stringContaining('سالن تست'));
      expect(sms.send).toHaveBeenCalledWith('09121234567', expect.stringContaining('http://localhost:3003/login'));
    });

    it('still returns successfully even when the SMS send fails (never blocks/fails worker creation)', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({
        user: { id: 'worker-user-1', phone: '09121234567' },
        isNew: true,
      });
      sms.send.mockRejectedValue(new Error('sms provider down'));

      const result = await controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' });
      await flush();

      expect(result).toMatchObject({ salonId: 'salon-1', userId: 'worker-user-1' });
    });

    it('does not SMS at all when the worker row fails to save (e.g. a 409 conflict)', async () => {
      usersService.findOrCreateByPhone.mockResolvedValue({
        user: { id: 'worker-user-1', phone: '09121234567' },
        isNew: false,
      });
      workers.save.mockRejectedValue(uniqueViolation());

      await expect(controller.create(OWNER_REQ, { name: 'Sara', phone: '09121234567' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await flush();

      expect(sms.send).not.toHaveBeenCalled();
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

  describe('updateServices', () => {
    it('404s for a worker belonging to a different salon', async () => {
      workers.findOneBy.mockResolvedValue(null);

      await expect(controller.updateServices(OWNER_REQ, 'worker-9', { serviceIds: [] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects a serviceId that does not belong to the caller salon', async () => {
      workers.findOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1' });
      salonServices.count.mockResolvedValue(1);

      await expect(
        controller.updateServices(OWNER_REQ, 'worker-1', { serviceIds: ['svc-1', 'svc-2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('replaces the worker service set inside a transaction', async () => {
      workers.findOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1' });
      salonServices.count.mockResolvedValue(2);
      const em = { delete: jest.fn(), insert: jest.fn() };
      dataSource.transaction.mockImplementation((fn) => fn(em));

      const result = await controller.updateServices(OWNER_REQ, 'worker-1', { serviceIds: ['svc-1', 'svc-2'] });

      expect(em.delete).toHaveBeenCalledWith(WorkerService, { workerId: 'worker-1' });
      expect(em.insert).toHaveBeenCalledWith(WorkerService, [
        { workerId: 'worker-1', serviceId: 'svc-1' },
        { workerId: 'worker-1', serviceId: 'svc-2' },
      ]);
      expect(result).toEqual({ id: 'worker-1', serviceIds: ['svc-1', 'svc-2'] });
    });

    it('clears a worker back to unrestricted with an empty array, skipping the insert', async () => {
      workers.findOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1' });
      const em = { delete: jest.fn(), insert: jest.fn() };
      dataSource.transaction.mockImplementation((fn) => fn(em));

      await controller.updateServices(OWNER_REQ, 'worker-1', { serviceIds: [] });

      expect(em.delete).toHaveBeenCalledWith(WorkerService, { workerId: 'worker-1' });
      expect(em.insert).not.toHaveBeenCalled();
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
