import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { WalletBalance, WalletCurrency } from './wallet-balance.entity';
import { WalletTransaction, WalletTransactionType } from './wallet-transaction.entity';

export interface WalletMovementOptions {
  referenceType?: string;
  referenceId?: string;
  reason?: string;
}

export interface DebitResult {
  debited: number;
  shortfall: number;
  balanceAfter: number;
  // null when debited is 0 -- no ledger row was written, so there is nothing to
  // reference. Lets a caller that couldn't name its own referenceId up front (e.g.
  // BookingsService.createHold, which doesn't have a booking id until after this
  // call) backfill it afterward via an update keyed on this id.
  transactionId: string | null;
}

export interface WalletTransactionPage {
  items: WalletTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminWalletTransactionListItem = WalletTransaction & { userPhone: string | null; userName: string | null };

export interface AdminWalletQuery {
  userId?: string;
  type?: WalletTransactionType;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The row-locked, never-negative ledger primitive every future slice (referral
 * rewards, reversals) will call. credit()/debit() never open their own transaction --
 * callers always pass an `em` bound to an existing transaction, since real usage will
 * always be one leg of a larger transaction (e.g. crediting a referrer alongside
 * inserting a referral_rewards row).
 */
@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletBalance) private readonly balances: Repository<WalletBalance>,
    @InjectRepository(WalletTransaction) private readonly transactions: Repository<WalletTransaction>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Race-safe upsert-then-lock: INSERT ... ON CONFLICT DO NOTHING creates the
   * (user_id, currency) row with balance 0 if it doesn't exist yet, then a
   * SELECT ... FOR UPDATE (via queryBuilder + setLock, same idiom as
   * CouponsService.resolveAndValidate's capped-coupon lock) serializes concurrent
   * credit/debit calls against this exact row. Two concurrent callers both attempting
   * the insert is safe -- one wins, the other's ON CONFLICT DO NOTHING is a no-op --
   * and both then queue on the row lock in turn.
   */
  private async lockOrCreateBalance(em: EntityManager, userId: string, currency: WalletCurrency): Promise<WalletBalance> {
    await em.query(
      `INSERT INTO wallet_balances (user_id, currency, balance) VALUES ($1, $2, 0) ON CONFLICT (user_id, currency) DO NOTHING`,
      [userId, currency],
    );
    const balance = await em
      .getRepository(WalletBalance)
      .createQueryBuilder('wallet_balance')
      .setLock('pessimistic_write')
      .where('wallet_balance.user_id = :userId AND wallet_balance.currency = :currency', { userId, currency })
      .getOne();
    // Never actually null -- the upsert above guarantees the row exists by the time
    // this SELECT runs. Guarded only so a caller mistake can't silently NPE downstream.
    if (!balance) throw new Error(`wallet_balances row missing for ${userId}/${currency} after upsert`);
    return balance;
  }

  /** Credit must be positive -- use debit() for negative movement. */
  async credit(
    em: EntityManager,
    userId: string,
    currency: WalletCurrency,
    amount: number,
    type: WalletTransactionType,
    opts: WalletMovementOptions = {},
  ): Promise<{ balanceAfter: number; transactionId: string }> {
    if (amount <= 0) throw new BadRequestException('Credit amount must be positive');

    const balance = await this.lockOrCreateBalance(em, userId, currency);
    const balanceAfter = balance.balance + amount;

    // Callers that need to link this movement back to their own row (e.g.
    // ReferralsService.tryGrantReward setting referral_rewards.wallet_transaction_id)
    // read the generated id off the insert result rather than a second query.
    const inserted = await em.getRepository(WalletTransaction).insert({
      userId,
      currency,
      amount,
      balanceAfter,
      type,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      reason: opts.reason ?? null,
    });
    await em.getRepository(WalletBalance).update({ userId, currency }, { balance: balanceAfter, updatedAt: new Date() });

    return { balanceAfter, transactionId: inserted.identifiers[0].id as string };
  }

  /**
   * amount is a positive number (the requested debit). Never lets balance go negative
   * (R11) -- caps at the available balance and reports the shortfall instead of
   * throwing, so a caller like a future referral reversal can roll the shortfall into
   * its own alerting without the whole transaction failing. Callers that need an
   * all-or-nothing debit (e.g. the admin adjust endpoint) must check `shortfall > 0`
   * themselves and reject before committing.
   */
  async debit(
    em: EntityManager,
    userId: string,
    currency: WalletCurrency,
    amount: number,
    type: WalletTransactionType,
    opts: WalletMovementOptions = {},
  ): Promise<DebitResult> {
    if (amount <= 0) throw new BadRequestException('Debit amount must be positive');

    const balance = await this.lockOrCreateBalance(em, userId, currency);
    const actualDebit = Math.min(amount, balance.balance);
    const shortfall = amount - actualDebit;

    if (actualDebit === 0) {
      return { debited: 0, shortfall, balanceAfter: balance.balance, transactionId: null };
    }

    const balanceAfter = balance.balance - actualDebit;
    const inserted = await em.getRepository(WalletTransaction).insert({
      userId,
      currency,
      amount: -actualDebit,
      balanceAfter,
      type,
      referenceType: opts.referenceType ?? null,
      referenceId: opts.referenceId ?? null,
      reason: opts.reason ?? null,
    });
    await em.getRepository(WalletBalance).update({ userId, currency }, { balance: balanceAfter, updatedAt: new Date() });

    return { debited: actualDebit, shortfall, balanceAfter, transactionId: inserted.identifiers[0].id as string };
  }

  /** Read-only, no lock -- all wallet_balances rows for a user. */
  getBalances(userId: string): Promise<WalletBalance[]> {
    return this.balances.find({ where: { userId } });
  }

  async getTransactions(
    userId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<WalletTransactionPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.transactions.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /**
   * Global ledger search for the admin Wallet Ledger screen -- filter by
   * userId/type/date range, paginated. Mirrors AuditService.listForAdmin's
   * where-object-building + follow-up user lookup shape verbatim.
   */
  async getTransactionsForAdmin(
    query: AdminWalletQuery,
  ): Promise<{ items: AdminWalletTransactionListItem[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.type) where.type = query.type;
    if (query.from && query.to) where.createdAt = Between(new Date(query.from), new Date(query.to));
    else if (query.from) where.createdAt = MoreThanOrEqual(new Date(query.from));
    else if (query.to) where.createdAt = LessThanOrEqual(new Date(query.to));

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.transactions.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Second lookup instead of a QB join: entities carry no relation decorators
    // (repo convention), and one IN query over <=100 ids is cheap.
    const userIds = [...new Set(items.map((item) => item.userId))];
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) }, select: ['id', 'phone', 'name'] }) : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const enriched = items.map((item) => ({
      ...item,
      userPhone: userById.get(item.userId)?.phone ?? null,
      userName: userById.get(item.userId)?.name ?? null,
    }));
    return { items: enriched, total, page, pageSize };
  }
}
