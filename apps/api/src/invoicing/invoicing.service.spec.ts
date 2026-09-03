import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Payment } from '../booking/payment.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Salon } from '../salons/salon.entity';
import { FinancialTransaction } from './financial-transaction.entity';
import { InvoiceItem } from './invoice-item.entity';
import { InvoicePayment } from './invoice-payment.entity';
import { Invoice } from './invoice.entity';
import { InvoicingService } from './invoicing.service';

describe('InvoicingService.recordCommission', () => {
  let service: InvoicingService;
  let emInsert: jest.Mock;
  let paymentFindOne: jest.Mock;
  let getCommissionPercent: jest.Mock;

  beforeEach(async () => {
    emInsert = jest.fn().mockResolvedValue(undefined);
    paymentFindOne = jest.fn();
    getCommissionPercent = jest.fn().mockResolvedValue(10);

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicingService,
        { provide: getRepositoryToken(FinancialTransaction), useValue: {} },
        { provide: getRepositoryToken(Invoice), useValue: {} },
        { provide: getRepositoryToken(InvoiceItem), useValue: {} },
        { provide: getRepositoryToken(InvoicePayment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: { getCommissionPercent } },
      ],
    }).compile();

    service = moduleRef.get(InvoicingService);
  });

  // The em hands back a Payment repo (findOne) and a FinancialTransaction repo (insert);
  // any other entity gets an empty stub so a wrong repository lookup fails loudly.
  function fakeEm() {
    return {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === Payment) return { findOne: paymentFindOne };
        if (entity === FinancialTransaction) return { insert: emInsert };
        return {};
      }),
    };
  }

  it('inserts a commission_accrued row computed from the CAPTURED payment amount, at the frozen live rate', async () => {
    paymentFindOne.mockResolvedValue({ amount: 100_000, status: 'paid' });
    const em = fakeEm();
    await service.recordCommission(em as never, { id: 'booking-1', salonId: 'salon-1' });

    expect(paymentFindOne).toHaveBeenCalledWith({ where: { bookingId: 'booking-1', status: 'paid' } });
    expect(getCommissionPercent).toHaveBeenCalled();
    expect(emInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        salonId: 'salon-1',
        type: 'commission_accrued',
        grossAmount: 100_000,
        commissionPercent: '10.00',
        commissionAmount: 10_000,
        netAmount: 90_000,
        correctionOfId: null,
      }),
    );
  });

  it('rounds the commission amount rather than truncating or leaving fractional toman', async () => {
    getCommissionPercent.mockResolvedValue(7);
    paymentFindOne.mockResolvedValue({ amount: 33_333, status: 'paid' });
    const em = fakeEm();
    // 33,333 * 7 / 100 = 2333.31 -> rounds to 2333
    await service.recordCommission(em as never, { id: 'b1', salonId: 's1' });

    expect(emInsert).toHaveBeenCalledWith(expect.objectContaining({ commissionAmount: 2333, netAmount: 33_333 - 2333 }));
  });

  it('does nothing for a booking with no paid Payment row -- deposit fully wallet/coupon-covered, or never collected because online payment was off', async () => {
    // The flag-off case is the one that matters in production: depositAmount is still
    // stored on the booking row (for CRM/reporting) but no money was ever captured, and
    // accruing on it would invoice the salon a payout of money the platform never held.
    paymentFindOne.mockResolvedValue(null);
    const em = fakeEm();
    await service.recordCommission(em as never, { id: 'b1', salonId: 's1' });

    expect(getCommissionPercent).not.toHaveBeenCalled();
    expect(emInsert).not.toHaveBeenCalled();
  });
});

describe('InvoicingService.recordPayment', () => {
  let service: InvoicingService;
  let emFindOneBy: jest.Mock;
  let emInsert: jest.Mock;
  let emUpdate: jest.Mock;
  let dataSourceTransaction: jest.Mock;

  const INVOICE = { id: 'inv-1', paidTotal: 0, totalNetPayable: 100_000, status: 'issued', paidAt: null };

  beforeEach(async () => {
    emFindOneBy = jest.fn().mockResolvedValue({ ...INVOICE });
    emInsert = jest.fn().mockResolvedValue(undefined);
    emUpdate = jest.fn().mockResolvedValue(undefined);
    // The locked read goes through a query builder (setLock('pessimistic_write')); the
    // post-update re-read still uses findOneBy. Both resolve from the same mock so the
    // existing per-test `emFindOneBy` overrides keep working.
    const lockedQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(() => emFindOneBy()),
    };
    dataSourceTransaction = jest.fn((cb: (em: unknown) => unknown) =>
      cb({
        findOneBy: emFindOneBy,
        insert: emInsert,
        update: emUpdate,
        getRepository: () => ({ createQueryBuilder: () => lockedQb }),
      }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicingService,
        { provide: getRepositoryToken(FinancialTransaction), useValue: {} },
        { provide: getRepositoryToken(Invoice), useValue: {} },
        { provide: getRepositoryToken(InvoiceItem), useValue: {} },
        { provide: getRepositoryToken(InvoicePayment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: DataSource, useValue: { transaction: dataSourceTransaction } },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(InvoicingService);
  });

  it('404s when the invoice does not exist', async () => {
    emFindOneBy.mockResolvedValue(null);

    await expect(
      service.recordPayment('missing', 'admin-1', { amount: 1000, method: 'bank_transfer' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(emInsert).not.toHaveBeenCalled();
  });

  it('refuses to record a payment against a void invoice', async () => {
    emFindOneBy.mockResolvedValue({ ...INVOICE, status: 'void' });

    await expect(
      service.recordPayment('inv-1', 'admin-1', { amount: 1000, method: 'bank_transfer' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(emInsert).not.toHaveBeenCalled();
  });

  it('inserts an InvoicePayment row and marks the invoice partially_paid when the payment is less than the total owed', async () => {
    await service.recordPayment('inv-1', 'admin-1', { amount: 40_000, method: 'bank_transfer', referenceNumber: 'REF-1' });

    expect(emInsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ invoiceId: 'inv-1', amount: 40_000, method: 'bank_transfer', recordedByAdminId: 'admin-1' }),
    );
    expect(emUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'inv-1' },
      expect.objectContaining({ paidTotal: 40_000, status: 'partially_paid', paidAt: null }),
    );
  });

  it('marks the invoice paid, with paidAt set, once the running total reaches totalNetPayable', async () => {
    emFindOneBy.mockResolvedValue({ ...INVOICE, paidTotal: 60_000 });

    await service.recordPayment('inv-1', 'admin-1', { amount: 40_000, method: 'cash' });

    expect(emUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'inv-1' },
      expect.objectContaining({ paidTotal: 100_000, status: 'paid', paidAt: expect.any(Date) }),
    );
  });

  it('flips an already-paid invoice back to partially_paid if a payment somehow lands below a since-grown total', async () => {
    // Simulates: totalNetPayable grew (a late invoice item) after this invoice was
    // already marked paid at the old, smaller total.
    emFindOneBy.mockResolvedValue({ ...INVOICE, paidTotal: 100_000, totalNetPayable: 150_000, status: 'paid' });

    await service.recordPayment('inv-1', 'admin-1', { amount: 10_000, method: 'cash' });

    expect(emUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'inv-1' },
      expect.objectContaining({ paidTotal: 110_000, status: 'partially_paid' }),
    );
  });
});
