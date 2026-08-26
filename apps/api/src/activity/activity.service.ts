import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { resolveNamesById } from '../common/resolve-names-by-id';
import { ReferralReward } from '../referrals/referral-reward.entity';
import { Review } from '../reviews/review.entity';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Worker } from '../salons/worker.entity';
import { WalletTransaction } from '../wallet/wallet-transaction.entity';

export type ActivityItemType = 'booking' | 'wallet_transaction' | 'review' | 'referral_reward';

export interface ActivityItem {
  type: ActivityItemType;
  id: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function decodeCursor(cursor?: string): Date | null {
  if (!cursor) return null;
  const parsed = new Date(cursor);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(WalletTransaction) private readonly walletTransactions: Repository<WalletTransaction>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(ReferralReward) private readonly referralRewards: Repository<ReferralReward>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly salonServices: Repository<SalonService>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
  ) {}

  // Merge strategy (see the design spec's own "deliberately simple, not a true cross-table
  // keyset cursor" note): fetch the top `limit` rows from EACH of the 4 source tables
  // (before the cursor timestamp), merge the <=4*limit rows in memory, sort DESC, slice to
  // `limit`. Can rarely skip/duplicate a row on an exact-timestamp tie across two different
  // sources at a page boundary -- accepted given per-user row counts are realistically in
  // the dozens-to-low-hundreds, not a scale where that matters. A real composite keyset
  // cursor across 4 heterogeneously-shaped tables would be meaningfully more code for no
  // practical benefit at this scale.
  async listMine(userId: string, cursor?: string, limit = DEFAULT_LIMIT): Promise<ActivityPage> {
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const before = decodeCursor(cursor);

    const [bookingRows, walletRows, reviewRows, rewardRows] = await Promise.all([
      this.fetchBookings(userId, before, boundedLimit),
      this.fetchWalletTransactions(userId, before, boundedLimit),
      this.fetchReviews(userId, before, boundedLimit),
      this.fetchReferralRewards(userId, before, boundedLimit),
    ]);

    const merged = [...bookingRows, ...walletRows, ...reviewRows, ...rewardRows].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
    const items = merged.slice(0, boundedLimit);
    // Two distinct "there might be more" signals, since a single source hitting its own
    // per-fetch cap exactly at `boundedLimit` wouldn't otherwise show up as merged having
    // MORE rows than what's returned (e.g. one source alone returns exactly `limit` rows
    // and every other source returns 0 -- merged.length === items.length in that case, but
    // that one source almost certainly has more beyond its own fetch window).
    const aSourceHitItsOwnCap = [bookingRows, walletRows, reviewRows, rewardRows].some(
      (rows) => rows.length === boundedLimit,
    );
    const hasMore = merged.length > items.length || aSourceHitItsOwnCap;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.occurredAt : null;

    return { items, nextCursor, hasMore };
  }

  private async fetchBookings(userId: string, before: Date | null, limit: number): Promise<ActivityItem[]> {
    const rows = await this.bookings.find({
      where: before ? { userId, createdAt: LessThan(before) } : { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (rows.length === 0) return [];

    const [salonNames, serviceNames, workerNames] = await Promise.all([
      resolveNamesById(this.salons, [...new Set(rows.map((r) => r.salonId))]),
      resolveNamesById(this.salonServices, [...new Set(rows.map((r) => r.serviceId))]),
      resolveNamesById(
        this.workers,
        [...new Set(rows.filter((r) => r.workerId).map((r) => r.workerId as string))],
      ),
    ]);

    return rows.map((r) => ({
      type: 'booking' as const,
      id: r.id,
      occurredAt: r.createdAt.toISOString(),
      detail: {
        status: r.status,
        source: r.source,
        salonName: salonNames.get(r.salonId) ?? 'نامشخص',
        serviceName: serviceNames.get(r.serviceId) ?? 'نامشخص',
        workerName: r.workerId ? (workerNames.get(r.workerId) ?? null) : null,
        startsAt: r.startsAt,
        priceSnapshot: r.priceSnapshot,
      },
    }));
  }

  private async fetchWalletTransactions(userId: string, before: Date | null, limit: number): Promise<ActivityItem[]> {
    const rows = await this.walletTransactions.find({
      where: before ? { userId, createdAt: LessThan(before) } : { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      type: 'wallet_transaction' as const,
      id: r.id,
      occurredAt: r.createdAt.toISOString(),
      detail: { type: r.type, amount: r.amount, balanceAfter: r.balanceAfter, reason: r.reason },
    }));
  }

  private async fetchReviews(userId: string, before: Date | null, limit: number): Promise<ActivityItem[]> {
    const rows = await this.reviews.find({
      where: before ? { userId, createdAt: LessThan(before) } : { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (rows.length === 0) return [];

    const salonNames = await resolveNamesById(this.salons, [...new Set(rows.map((r) => r.salonId))]);

    return rows.map((r) => ({
      type: 'review' as const,
      id: r.id,
      occurredAt: r.createdAt.toISOString(),
      detail: {
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        salonName: salonNames.get(r.salonId) ?? 'نامشخص',
        bookingId: r.bookingId,
      },
    }));
  }

  private async fetchReferralRewards(userId: string, before: Date | null, limit: number): Promise<ActivityItem[]> {
    const rows = await this.referralRewards.find({
      where: before ? { beneficiaryUserId: userId, grantedAt: LessThan(before) } : { beneficiaryUserId: userId },
      order: { grantedAt: 'DESC' },
      take: limit,
    });
    return rows.map((r) => ({
      type: 'referral_reward' as const,
      id: r.id,
      occurredAt: r.grantedAt.toISOString(),
      detail: {
        beneficiaryRole: r.beneficiaryRole,
        rewardKind: r.rewardKind,
        rewardValue: r.rewardValue,
        status: r.status,
      },
    }));
  }
}
