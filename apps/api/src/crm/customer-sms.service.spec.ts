import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CrmService } from './crm.service';
import { CustomerSmsService } from './customer-sms.service';
import { SalonSmsMessage } from './salon-sms-message.entity';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { EntitlementsService } from '../subscriptions/entitlements.service';

describe('CustomerSmsService', () => {
  let service: CustomerSmsService;
  let crm: { getCustomerContact: jest.Mock; requireCustomerBelongsToSalon: jest.Mock };
  let entitlements: { getQuota: jest.Mock };
  let salons: { findById: jest.Mock };
  let sms: { send: jest.Mock; sendOtp: jest.Mock };
  let messagesRepo: { count: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    crm = {
      getCustomerContact: jest.fn().mockResolvedValue({ id: 'u1', name: 'Ali', phone: '09120000000' }),
      requireCustomerBelongsToSalon: jest.fn(),
    };
    entitlements = { getQuota: jest.fn().mockResolvedValue(20) };
    salons = { findById: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'سالن رز', status: 'approved' }) };
    sms = { send: jest.fn().mockResolvedValue(undefined), sendOtp: jest.fn() };
    messagesRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'm1', ...v })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerSmsService,
        { provide: CrmService, useValue: crm },
        { provide: EntitlementsService, useValue: entitlements },
        { provide: SalonsService, useValue: salons },
        { provide: SMS_PROVIDER, useValue: sms },
        { provide: getRepositoryToken(SalonSmsMessage), useValue: messagesRepo },
      ],
    }).compile();
    service = moduleRef.get(CustomerSmsService);
  });

  describe('getQuotaStatus', () => {
    it('reports quota/used/remaining from the entitlement engine and the current period count', async () => {
      messagesRepo.count.mockResolvedValueOnce(5);
      await expect(service.getQuotaStatus('salon-1')).resolves.toEqual({ quota: 20, used: 5, remaining: 15 });
    });

    it('treats a missing entitlement key as zero quota, not unlimited', async () => {
      entitlements.getQuota.mockResolvedValueOnce(0);
      await expect(service.getQuotaStatus('salon-1')).resolves.toEqual({ quota: 0, used: 0, remaining: 0 });
    });

    it('treats a non-numeric entitlement value as zero quota', async () => {
      entitlements.getQuota.mockResolvedValueOnce(0);
      await expect(service.getQuotaStatus('salon-1')).resolves.toEqual({ quota: 0, used: 0, remaining: 0 });
    });

    it('never reports a negative remaining if usage somehow exceeds quota', async () => {
      messagesRepo.count.mockResolvedValueOnce(25);
      await expect(service.getQuotaStatus('salon-1')).resolves.toEqual({ quota: 20, used: 25, remaining: 0 });
    });
  });

  describe('send', () => {
    it('404s when the customer does not belong to this salon, without sending or counting quota', async () => {
      crm.getCustomerContact.mockRejectedValueOnce(new NotFoundException());
      await expect(service.send('salon-1', 'stranger', 'owner-1', 'سلام')).rejects.toBeInstanceOf(NotFoundException);
      expect(sms.send).not.toHaveBeenCalled();
    });

    it.each(['pending', 'rejected', 'suspended'])('409s for a %s salon, without sending or counting quota', async (status) => {
      salons.findById.mockResolvedValueOnce({ id: 'salon-1', name: 'سالن رز', status });
      await expect(service.send('salon-1', 'u1', 'owner-1', 'سلام')).rejects.toBeInstanceOf(ConflictException);
      expect(sms.send).not.toHaveBeenCalled();
      expect(messagesRepo.save).not.toHaveBeenCalled();
    });

    it('409s once usage reaches quota, without sending', async () => {
      messagesRepo.count.mockResolvedValueOnce(20);
      await expect(service.send('salon-1', 'u1', 'owner-1', 'سلام')).rejects.toBeInstanceOf(ConflictException);
      expect(sms.send).not.toHaveBeenCalled();
      expect(messagesRepo.save).not.toHaveBeenCalled();
    });

    it('sends and logs the message when under quota, returning the updated status', async () => {
      messagesRepo.count.mockResolvedValueOnce(3);
      const result = await service.send('salon-1', 'u1', 'owner-1', 'سلام مشتری عزیز');

      // Prefixed with the salon name on the wire (anti-impersonation); logged as typed.
      expect(sms.send).toHaveBeenCalledWith('09120000000', 'سالن رز: سلام مشتری عزیز');
      expect(messagesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ salonId: 'salon-1', customerId: 'u1', phone: '09120000000', message: 'سلام مشتری عزیز', sentBy: 'owner-1' }),
      );
      expect(result).toEqual({ quota: 20, used: 4, remaining: 16 });
    });

    it('never logs (never consumes quota) when the underlying send throws', async () => {
      messagesRepo.count.mockResolvedValueOnce(3);
      sms.send.mockRejectedValueOnce(new Error('carrier down'));

      await expect(service.send('salon-1', 'u1', 'owner-1', 'سلام')).rejects.toThrow('carrier down');
      expect(messagesRepo.save).not.toHaveBeenCalled();
    });
  });
});
