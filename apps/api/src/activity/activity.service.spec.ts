import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Booking } from '../booking/booking.entity';
import { ReferralReward } from '../referrals/referral-reward.entity';
import { Review } from '../reviews/review.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { WalletTransaction } from '../wallet/wallet-transaction.entity';
import { ActivityService } from './activity.service';

describe('ActivityService.listMine', () => {
  let service: ActivityService;
  let bookings: { find: jest.Mock };
  let walletTransactions: { find: jest.Mock };
  let reviews: { find: jest.Mock };
  let referralRewards: { find: jest.Mock };
  let salons: { find: jest.Mock };
  let salonServices: { find: jest.Mock };
  let workers: { find: jest.Mock };

  beforeEach(async () => {
    bookings = { find: jest.fn().mockResolvedValue([]) };
    walletTransactions = { find: jest.fn().mockResolvedValue([]) };
    reviews = { find: jest.fn().mockResolvedValue([]) };
    referralRewards = { find: jest.fn().mockResolvedValue([]) };
    salons = { find: jest.fn().mockResolvedValue([]) };
    salonServices = { find: jest.fn().mockResolvedValue([]) };
    workers = { find: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: getRepositoryToken(Booking), useValue: bookings },
        { provide: getRepositoryToken(WalletTransaction), useValue: walletTransactions },
        { provide: getRepositoryToken(Review), useValue: reviews },
        { provide: getRepositoryToken(ReferralReward), useValue: referralRewards },
        { provide: getRepositoryToken(Salon), useValue: salons },
        { provide: getRepositoryToken(SalonService), useValue: salonServices },
        { provide: getRepositoryToken(Worker), useValue: workers },
      ],
    }).compile();
    service = moduleRef.get(ActivityService);
  });

  it('returns an empty page with hasMore:false when the user has no activity at all', async () => {
    const result = await service.listMine('user-1');
    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('merges all 4 sources into one feed, sorted newest-first', async () => {
    bookings.find.mockResolvedValue([
      { id: 'b1', userId: 'user-1', salonId: 's1', serviceId: 'svc1', workerId: null, status: 'completed', source: 'online', startsAt: new Date('2026-08-01T10:00:00Z'), priceSnapshot: 100_000, createdAt: new Date('2026-08-01T09:00:00Z') },
    ]);
    walletTransactions.find.mockResolvedValue([
      { id: 'w1', userId: 'user-1', type: 'referral_reward', amount: 50_000, balanceAfter: 50_000, reason: null, createdAt: new Date('2026-08-03T09:00:00Z') },
    ]);
    reviews.find.mockResolvedValue([
      { id: 'r1', userId: 'user-1', salonId: 's1', bookingId: 'b1', rating: 5, comment: 'عالی بود', status: 'published', createdAt: new Date('2026-08-02T09:00:00Z') },
    ]);
    referralRewards.find.mockResolvedValue([
      { id: 'rr1', beneficiaryUserId: 'user-1', beneficiaryRole: 'referrer', rewardKind: 'wallet_credit', rewardValue: 50_000, status: 'granted', grantedAt: new Date('2026-08-04T09:00:00Z') },
    ]);
    salons.find.mockResolvedValue([{ id: 's1', name: 'سالن نمونه' }]);
    salonServices.find.mockResolvedValue([{ id: 'svc1', name: 'کوتاهی مو' }]);

    const result = await service.listMine('user-1');

    expect(result.items.map((i) => i.type)).toEqual([
      'referral_reward', // Aug 4
      'wallet_transaction', // Aug 3
      'review', // Aug 2
      'booking', // Aug 1
    ]);
    expect(result.items[2]!.detail).toMatchObject({ salonName: 'سالن نمونه', rating: 5 });
    expect(result.items[3]!.detail).toMatchObject({ salonName: 'سالن نمونه', serviceName: 'کوتاهی مو' });
    expect(result.hasMore).toBe(false);
  });

  it('scopes every source query to the requesting user (never leaks another user\'s rows)', async () => {
    await service.listMine('user-42');

    expect(bookings.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-42' } }));
    expect(walletTransactions.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-42' } }));
    expect(reviews.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-42' } }));
    expect(referralRewards.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { beneficiaryUserId: 'user-42' } }),
    );
  });

  it('falls back to a placeholder name when a booking\'s salon/service id resolves to nothing', async () => {
    bookings.find.mockResolvedValue([
      { id: 'b1', userId: 'user-1', salonId: 'missing-salon', serviceId: 'missing-service', workerId: null, status: 'completed', source: 'online', startsAt: new Date(), priceSnapshot: 1, createdAt: new Date() },
    ]);
    salons.find.mockResolvedValue([]);
    salonServices.find.mockResolvedValue([]);

    const result = await service.listMine('user-1');

    expect(result.items[0]!.detail).toMatchObject({ salonName: 'نامشخص', serviceName: 'نامشخص' });
  });

  it('paginates via an ISO-timestamp cursor, passing it as a LessThan bound to every source', async () => {
    const cursor = '2026-08-01T00:00:00.000Z';
    await service.listMine('user-1', cursor);

    const call = bookings.find.mock.calls[0][0];
    expect(call.where.createdAt._type).toBe('lessThan');
    expect(call.where.createdAt._value).toEqual(new Date(cursor));
  });

  it('sets hasMore:true and a real nextCursor when a single source alone fills the whole page', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `w${i}`,
      userId: 'user-1',
      type: 'admin_adjustment',
      amount: 1000,
      balanceAfter: 1000,
      reason: null,
      createdAt: new Date(Date.now() - i * 1000),
    }));
    walletTransactions.find.mockResolvedValue(rows);

    const result = await service.listMine('user-1', undefined, 3);

    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(result.items[2]!.occurredAt);
  });

  it('clamps an absurdly large limit to the max page size', async () => {
    await service.listMine('user-1', undefined, 10_000);

    expect(bookings.find).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });
});
