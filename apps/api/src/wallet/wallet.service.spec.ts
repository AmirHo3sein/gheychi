import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { WalletBalance } from './wallet-balance.entity';
import { WalletTransaction } from './wallet-transaction.entity';
import { WalletService } from './wallet.service';

// A fake EntityManager that mimics the real credit()/debit() call shape (upsert-via-
// query -> lock-and-read via queryBuilder -> insert wallet_transactions -> update
// wallet_balances) against an in-memory balance map, so accumulation across multiple
// calls sharing one `em` is provable without a real Postgres row lock. True
// concurrency safety (two DB transactions racing on the same row) is proven at the
// DB level by the queryBuilder's `.setLock('pessimistic_write')` + Postgres's own
// row-locking semantics, not unit-testable here -- this only proves the lock is
// invoked and that sequential calls against a shared "transaction" accumulate correctly.
function makeFakeEm(initialBalances: Record<string, number> = {}) {
  const store = new Map<string, number>(Object.entries(initialBalances));
  const key = (userId: string, currency: string) => `${userId}:${currency}`;

  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queryCalls.push({ sql, params });
    if (sql.includes('INSERT INTO wallet_balances')) {
      const [userId, currency] = params as [string, string];
      const k = key(userId, currency);
      if (!store.has(k)) store.set(k, 0);
    }
    return [];
  });

  let lastLockedKey: string | null = null;
  const setLockCalls: string[] = [];

  const walletBalanceRepo = {
    createQueryBuilder: jest.fn(() => {
      const qb = {
        setLock: jest.fn((mode: string) => {
          setLockCalls.push(mode);
          return qb;
        }),
        where: jest.fn((_cond: string, params: { userId: string; currency: string }) => {
          lastLockedKey = key(params.userId, params.currency);
          return qb;
        }),
        getOne: jest.fn(async () => {
          if (lastLockedKey === null || !store.has(lastLockedKey)) return null;
          const [userId, currency] = lastLockedKey.split(':');
          return { userId, currency, balance: store.get(lastLockedKey) } as WalletBalance;
        }),
      };
      return qb;
    }),
    update: jest.fn(async (criteria: { userId: string; currency: string }, partial: { balance: number }) => {
      store.set(key(criteria.userId, criteria.currency), partial.balance);
      return { affected: 1 };
    }),
  };

  const insertCalls: Array<Record<string, unknown>> = [];
  const walletTransactionRepo = {
    insert: jest.fn(async (data: Record<string, unknown>) => {
      insertCalls.push(data);
      return { identifiers: [{ id: 'tx-id' }] };
    }),
  };

  const em = {
    query,
    getRepository: jest.fn((entity: unknown) => {
      if (entity === WalletBalance) return walletBalanceRepo;
      if (entity === WalletTransaction) return walletTransactionRepo;
      throw new Error('unexpected entity requested from fake EntityManager');
    }),
  } as unknown as EntityManager;

  return { em, store, insertCalls, queryCalls, setLockCalls, walletBalanceRepo, walletTransactionRepo };
}

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getRepositoryToken(WalletBalance), useValue: {} },
        { provide: getRepositoryToken(WalletTransaction), useValue: {} },
        { provide: getRepositoryToken(User), useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(WalletService);
  });

  describe('credit', () => {
    it('creates the balance row if missing (upsert-then-lock) and sets balance to the credited amount', async () => {
      const { em, store, insertCalls } = makeFakeEm();
      const result = await service.credit(em, 'user-1', 'toman', 1000, 'admin_adjustment', { reason: 'test' });

      expect(result.balanceAfter).toBe(1000);
      expect(store.get('user-1:toman')).toBe(1000);
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]).toMatchObject({
        userId: 'user-1',
        currency: 'toman',
        amount: 1000,
        balanceAfter: 1000,
        type: 'admin_adjustment',
        reason: 'test',
      });
    });

    it('accumulates correctly on an existing balance', async () => {
      const { em, store } = makeFakeEm({ 'user-1:toman': 500 });
      const result = await service.credit(em, 'user-1', 'toman', 250, 'admin_adjustment');

      expect(result.balanceAfter).toBe(750);
      expect(store.get('user-1:toman')).toBe(750);
    });

    it('row-locks the balance row (proves the lock is invoked; real concurrency is DB-proven, not unit-testable)', async () => {
      const { em, setLockCalls } = makeFakeEm();
      await service.credit(em, 'user-1', 'toman', 100, 'admin_adjustment');
      expect(setLockCalls).toContain('pessimistic_write');
    });

    it.each([0, -1, -100])('throws for a non-positive amount (%d)', async (amount) => {
      const { em } = makeFakeEm();
      await expect(service.credit(em, 'user-1', 'toman', amount, 'admin_adjustment')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('debit', () => {
    it('debits the full amount when the balance covers it, with zero shortfall', async () => {
      const { em, store } = makeFakeEm({ 'user-1:toman': 1000 });
      const result = await service.debit(em, 'user-1', 'toman', 400, 'admin_adjustment');

      expect(result).toEqual({ debited: 400, shortfall: 0, balanceAfter: 600, transactionId: 'tx-id' });
      expect(store.get('user-1:toman')).toBe(600);
    });

    it('caps the debit at the available balance and reports the shortfall instead of throwing', async () => {
      const { em, store, insertCalls } = makeFakeEm({ 'user-1:toman': 40 });
      const result = await service.debit(em, 'user-1', 'toman', 120, 'admin_adjustment');

      expect(result).toEqual({ debited: 40, shortfall: 80, balanceAfter: 0, transactionId: 'tx-id' });
      expect(store.get('user-1:toman')).toBe(0);
      expect(insertCalls[0]).toMatchObject({ amount: -40, balanceAfter: 0 });
    });

    it('leaves balance at exactly 0 (never negative -- R11) when debiting more than the balance', async () => {
      const { em, store } = makeFakeEm({ 'user-1:toman': 40 });
      await service.debit(em, 'user-1', 'toman', 999999, 'admin_adjustment');
      expect(store.get('user-1:toman')).toBe(0);
    });

    it('does nothing (no transaction row, no balance update) and returns debited:0 when the balance is already 0', async () => {
      const { em, store, insertCalls, walletBalanceRepo } = makeFakeEm({ 'user-1:toman': 0 });
      const result = await service.debit(em, 'user-1', 'toman', 50, 'admin_adjustment');

      expect(result).toEqual({ debited: 0, shortfall: 50, balanceAfter: 0, transactionId: null });
      expect(store.get('user-1:toman')).toBe(0);
      expect(insertCalls).toHaveLength(0);
      expect(walletBalanceRepo.update).not.toHaveBeenCalled();
    });

    it.each([0, -1, -100])('throws for a non-positive amount (%d)', async (amount) => {
      const { em } = makeFakeEm();
      await expect(service.debit(em, 'user-1', 'toman', amount, 'admin_adjustment')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('concurrent-shaped usage (sequential calls sharing one em/transaction)', () => {
    // Real concurrency (two DB transactions racing on the same wallet_balances row) is
    // proven by Postgres's row lock underneath `.setLock('pessimistic_write')`, not by
    // this unit test -- this only proves that two calls sharing one `em` (the same
    // shape a real single DB transaction would have) serialize correctly against the
    // shared in-memory balance, i.e. the second call sees the first call's write.
    it('a credit followed by a debit against the same user accumulate in the correct order', async () => {
      const { em, store } = makeFakeEm({ 'user-1:toman': 100 });

      const creditResult = await service.credit(em, 'user-1', 'toman', 500, 'admin_adjustment');
      expect(creditResult.balanceAfter).toBe(600);

      const debitResult = await service.debit(em, 'user-1', 'toman', 200, 'admin_adjustment');
      expect(debitResult).toEqual({ debited: 200, shortfall: 0, balanceAfter: 400, transactionId: 'tx-id' });
      expect(store.get('user-1:toman')).toBe(400);
    });
  });

  describe('getBalances / getTransactions', () => {
    it('getBalances returns all rows for a user, read-only (no lock)', async () => {
      const find = jest.fn().mockResolvedValue([{ userId: 'u1', currency: 'toman', balance: 10 }]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          WalletService,
          { provide: getRepositoryToken(WalletBalance), useValue: { find } },
          { provide: getRepositoryToken(WalletTransaction), useValue: {} },
          { provide: getRepositoryToken(User), useValue: {} },
        ],
      }).compile();
      const svc = moduleRef.get(WalletService);

      const result = await svc.getBalances('u1');
      expect(find).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(result).toEqual([{ userId: 'u1', currency: 'toman', balance: 10 }]);
    });

    it('getTransactions paginates newest-first, scoped to the caller', async () => {
      const findAndCount = jest.fn().mockResolvedValue([[{ id: 't1' }], 1]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          WalletService,
          { provide: getRepositoryToken(WalletBalance), useValue: {} },
          { provide: getRepositoryToken(WalletTransaction), useValue: { findAndCount } },
          { provide: getRepositoryToken(User), useValue: {} },
        ],
      }).compile();
      const svc = moduleRef.get(WalletService);

      const result = await svc.getTransactions('u1', { page: 2, pageSize: 10 });
      expect(findAndCount).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { createdAt: 'DESC' },
        skip: 10,
        take: 10,
      });
      expect(result).toEqual({ items: [{ id: 't1' }], total: 1, page: 2, pageSize: 10 });
    });
  });
});
