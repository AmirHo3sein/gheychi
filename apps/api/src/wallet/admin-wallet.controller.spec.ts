import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminWalletController } from './admin-wallet.controller';
import { WalletService } from './wallet.service';

// Instantiated directly (not via Test.createTestingModule) -- same convention as
// salon-workers.controller.spec.ts / wallet.controller.spec.ts. Auth/role-guard 403
// behavior is exercised for real in test/wallet.e2e-spec.ts.
describe('AdminWalletController', () => {
  let controller: AdminWalletController;
  let credit: jest.Mock;
  let debit: jest.Mock;
  let getTransactionsForAdmin: jest.Mock;
  let getBalances: jest.Mock;
  let dataSource: { transaction: jest.Mock };
  // Real controller logic (not the interceptor -- see audit.interceptor.spec.ts for
  // that) stashes the wallet's before/after balance on this plain object, mirroring
  // what AuditInterceptor would read off the real Express request.
  let req: { auditBefore?: unknown; auditAfter?: unknown };

  beforeEach(() => {
    credit = jest.fn();
    debit = jest.fn();
    getTransactionsForAdmin = jest.fn();
    getBalances = jest.fn().mockResolvedValue([]);
    // transaction() just invokes the callback with a fake `em` and returns its result
    // (or lets it throw), mirroring DataSource.transaction's real contract closely
    // enough to exercise the controller's dispatch/validation logic.
    dataSource = { transaction: jest.fn((cb: (em: unknown) => unknown) => cb({})) };
    req = {};

    controller = new AdminWalletController(
      { credit, debit, getTransactionsForAdmin, getBalances } as unknown as WalletService,
      dataSource as unknown as DataSource,
    );
  });

  describe('GET /transactions', () => {
    it('delegates straight to WalletService.getTransactionsForAdmin with the query', () => {
      const query = { userId: 'u1', type: 'admin_adjustment' as const, page: 1, pageSize: 20 };
      controller.list(query);
      expect(getTransactionsForAdmin).toHaveBeenCalledWith(query);
    });
  });

  describe('POST /adjust', () => {
    it('rejects amount === 0 with 400, without opening a transaction', async () => {
      await expect(
        controller.adjust({ userId: 'u1', amount: 0, reason: 'oops' }, req as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('routes a positive amount to WalletService.credit with the reason and default currency', async () => {
      credit.mockResolvedValue({ balanceAfter: 1500 });
      const result = await controller.adjust({ userId: 'u1', amount: 500, reason: 'goodwill credit' }, req as never);

      expect(credit).toHaveBeenCalledWith(expect.anything(), 'u1', 'toman', 500, 'admin_adjustment', {
        reason: 'goodwill credit',
      });
      expect(debit).not.toHaveBeenCalled();
      expect(result).toEqual({ balanceAfter: 1500 });
    });

    it('routes a negative amount to WalletService.debit with the positive magnitude', async () => {
      debit.mockResolvedValue({ debited: 300, shortfall: 0, balanceAfter: 700 });
      const result = await controller.adjust({ userId: 'u1', amount: -300, reason: 'correcting a mistake' }, req as never);

      expect(debit).toHaveBeenCalledWith(expect.anything(), 'u1', 'toman', 300, 'admin_adjustment', {
        reason: 'correcting a mistake',
      });
      expect(credit).not.toHaveBeenCalled();
      expect(result).toEqual({ balanceAfter: 700 });
    });

    it('honors an explicit currency', async () => {
      credit.mockResolvedValue({ balanceAfter: 10 });
      await controller.adjust({ userId: 'u1', amount: 10, currency: 'points', reason: 'loyalty fix' }, req as never);
      expect(credit).toHaveBeenCalledWith(expect.anything(), 'u1', 'points', 10, 'admin_adjustment', {
        reason: 'loyalty fix',
      });
    });

    it('rejects with 400 when the debit would exceed the current balance -- full amount or nothing, never a silent partial correction', async () => {
      debit.mockResolvedValue({ debited: 40, shortfall: 60, balanceAfter: 0 });

      await expect(
        controller.adjust({ userId: 'u1', amount: -100, reason: 'correcting a mistake' }, req as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stashes the pre- and post-adjustment balance on req for AuditInterceptor to diff', async () => {
      getBalances.mockResolvedValue([{ userId: 'u1', currency: 'toman', balance: 1000 }]);
      credit.mockResolvedValue({ balanceAfter: 1500 });

      await controller.adjust({ userId: 'u1', amount: 500, reason: 'goodwill credit' }, req as never);

      expect(req.auditBefore).toEqual({ userId: 'u1', currency: 'toman', balance: 1000 });
      expect(req.auditAfter).toEqual({ userId: 'u1', currency: 'toman', balance: 1500 });
    });

    it('leaves req.auditAfter unset when a debit is rejected for insufficient balance', async () => {
      getBalances.mockResolvedValue([{ userId: 'u1', currency: 'toman', balance: 40 }]);
      debit.mockResolvedValue({ debited: 40, shortfall: 60, balanceAfter: 0 });

      await expect(
        controller.adjust({ userId: 'u1', amount: -100, reason: 'correcting a mistake' }, req as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(req.auditBefore).toEqual({ userId: 'u1', currency: 'toman', balance: 40 });
      expect(req.auditAfter).toBeUndefined();
    });
  });
});
