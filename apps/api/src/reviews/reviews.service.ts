import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CreateReviewDto } from './dto/review.dto';
import { Review } from './review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {}

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    const booking = await this.bookings.findOneBy({ id: dto.bookingId, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'completed') {
      throw new BadRequestException('Only completed bookings can be reviewed');
    }

    const existing = await this.reviews.findOneBy({ bookingId: dto.bookingId });
    if (existing) throw new ConflictException('This booking has already been reviewed');

    try {
      return await this.dataSource.transaction(async (em) => {
        const review = await em.save(
          Review,
          em.create(Review, {
            bookingId: booking.id,
            salonId: booking.salonId,
            userId,
            rating: dto.rating,
            comment: dto.comment ?? null,
            status: 'published',
          }),
        );
        await this.recomputeSalonRating(em, booking.salonId);
        return review;
      });
    } catch (err) {
      // The pre-check above handles the common case, but the DB's own UNIQUE
      // constraint on booking_id is the actual source of truth (per the design
      // spec: "reviews.booking_id UNIQUE enforces verified-only reviews at the
      // database level") -- a genuinely concurrent double-submit for the same
      // booking can still reach here, so translate that into the same clean
      // 409 rather than leaking a raw Postgres error.
      if (isUniqueViolation(err)) {
        throw new ConflictException('This booking has already been reviewed');
      }
      throw err;
    }
  }

  findForSalon(salonId: string): Promise<Review[]> {
    return this.reviews.find({ where: { salonId, status: 'published' }, order: { createdAt: 'DESC' } });
  }

  async listForAdmin(query: {
    salonId?: string;
    status?: 'published' | 'rejected';
    rating?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: Review[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (query.salonId) where.salonId = query.salonId;
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.reviews.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async addSalonReply(salonId: string, reviewId: string, reply: string): Promise<Review> {
    const review = await this.reviews.findOneBy({ id: reviewId, salonId });
    if (!review) throw new NotFoundException('Review not found');
    await this.reviews.update({ id: reviewId }, { salonReply: reply, salonReplyAt: new Date() });
    return (await this.reviews.findOneBy({ id: reviewId }))!;
  }

  async moderate(reviewId: string, status: 'published' | 'rejected'): Promise<Review> {
    const review = await this.reviews.findOneBy({ id: reviewId });
    if (!review) throw new NotFoundException('Review not found');

    await this.dataSource.transaction(async (em) => {
      await em.update(Review, { id: reviewId }, { status });
      await this.recomputeSalonRating(em, review.salonId);
    });

    return (await this.reviews.findOneBy({ id: reviewId }))!;
  }

  private async recomputeSalonRating(em: EntityManager, salonId: string): Promise<void> {
    // Recomputed from source of truth every time (not incremented/decremented in
    // place) -- avoids float-drift bugs, and this exact same query handles a new
    // published review, an admin rejection, and an admin reversal with identical
    // logic. Cheap at MVP scale (at most a few hundred reviews per salon).
    //
    // Lock-then-read-then-write, NOT a single UPDATE...FROM(aggregate subquery).
    // A plain single-statement UPDATE has a genuine lost-update race: if it blocks
    // waiting for another concurrent recompute's lock on this same salon row,
    // Postgres's read-committed re-check (documented at
    // postgresql.org/docs/current/transaction-iso.html) only re-validates the
    // WHERE clause against the newer row version -- it does NOT re-evaluate a
    // FROM-subquery's aggregate over a *different* table (reviews). So the
    // unblocked transaction would silently overwrite the winner's fresh aggregate
    // with its own stale one, computed before the winner's review was ever
    // committed -- undercounting a review that genuinely exists as 'published'.
    // Locking the salon row FIRST, then reading the aggregate as a separate fresh
    // query, forces any transaction that had to wait on the lock to compute its
    // aggregate only after the lock is actually free (i.e. after the prior
    // transaction committed), so it always reflects every review committed so far.
    await em.query(`SELECT id FROM salons WHERE id = $1 FOR UPDATE`, [salonId]);
    const [{ avg_rating, review_count }] = await em.query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating, COUNT(*)::int AS review_count
       FROM reviews
       WHERE salon_id = $1 AND status = 'published'`,
      [salonId],
    );
    await em.query(`UPDATE salons SET rating_avg = $2, rating_count = $3 WHERE id = $1`, [
      salonId,
      avg_rating,
      review_count,
    ]);
  }
}
