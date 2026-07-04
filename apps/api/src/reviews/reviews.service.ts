import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { CreateReviewDto } from './dto/review.dto';
import { Review } from './review.entity';

const UNIQUE_VIOLATION = '23505';

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
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('This booking has already been reviewed');
      }
      throw err;
    }
  }

  private async recomputeSalonRating(em: EntityManager, salonId: string): Promise<void> {
    // Recomputed from source of truth every time (not incremented/decremented in
    // place) -- avoids float-drift and race-condition bugs, and this exact same
    // query handles a new published review, an admin rejection, and an admin
    // reversal with identical logic. Cheap at MVP scale (at most a few hundred
    // reviews per salon).
    await em.query(
      `UPDATE salons
       SET rating_avg = sub.avg_rating, rating_count = sub.review_count
       FROM (
         SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating, COUNT(*)::int AS review_count
         FROM reviews
         WHERE salon_id = $1 AND status = 'published'
       ) sub
       WHERE salons.id = $1`,
      [salonId],
    );
  }
}
