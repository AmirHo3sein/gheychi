import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { UsersService } from '../users/users.service';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock; update: jest.Mock };
  let notifications: { emit: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn(), save: jest.fn((s) => s), update: jest.fn() };
    notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonsService,
        { provide: getRepositoryToken(Salon), useValue: repo },
        { provide: UsersService, useValue: {} },
        { provide: AdminNotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  describe('updateMine', () => {
    it('applies a genderTarget change', async () => {
      repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', genderTarget: 'women' } as Salon);
      const result = await service.updateMine('u1', { genderTarget: 'men' });
      expect(result.genderTarget).toBe('men');
    });
  });

  describe('resubmitMine notification hook', () => {
    const rejected = { id: 's1', ownerId: 'u1', name: 'سالن نمونه', status: 'rejected' } as Salon;
    const pending = {
      id: 's1',
      ownerId: 'u1',
      name: 'سالن نمونه',
      status: 'pending',
      rejectionReason: null,
    } as Salon;

    it('emits salon_resubmitted after a successful resubmit', async () => {
      // resubmitMine reads the salon twice: once before the conditional update,
      // once after it to return the fresh row.
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });

      const result = await service.resubmitMine('u1');

      expect(result.status).toBe('pending');
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'salon_resubmitted',
        'سالن «سالن نمونه» دوباره برای بررسی ارسال شد',
        'مالک سالن پس از رد شدن، اطلاعات را ویرایش و درخواست بررسی مجدد ثبت کرده است.',
        '/salons/s1',
      );
    });

    it('does not emit when the conditional update loses the race (409)', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected);
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(service.resubmitMine('u1')).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    it('swallows an emit failure — the resubmission still succeeds', async () => {
      repo.findOneBy.mockResolvedValueOnce(rejected).mockResolvedValueOnce(pending);
      repo.update.mockResolvedValue({ affected: 1 });
      notifications.emit.mockRejectedValueOnce(new Error('notification insert failed'));

      const result = await service.resubmitMine('u1');
      expect(result.status).toBe('pending');
    });
  });
});
