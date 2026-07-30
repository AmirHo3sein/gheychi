import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { Review, ReviewStatus } from './review.entity';
import { WorkerRating } from './worker-rating.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerRating) private readonly workerRatings: Repository<WorkerRating>,
    private readonly dataSource: DataSource,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    const booking = await this.bookings.findOneBy({ id: dto.bookingId, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'completed') {
      throw new BadRequestException('Only completed bookings can be reviewed');
    }
    // R9 / booking.workerId is the sole source of truth for whether this review must
    // carry a worker rating -- required when a worker performed the service, rejected
    // (there's nobody to rate) otherwise.
    if (booking.workerId && dto.workerRating === undefined) {
      throw new BadRequestException('برای این رزرو باید به کارمند مربوطه امتیاز دهید');
    }
    if (!booking.workerId && dto.workerRating !== undefined) {
      throw new BadRequestException('این رزرو کارمند مشخصی ندارد');
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

        if (booking.workerId && dto.workerRating !== undefined) {
          await em.save(
            WorkerRating,
            em.create(WorkerRating, {
              reviewId: review.id,
              bookingId: booking.id,
              workerId: booking.workerId,
              salonId: booking.salonId,
              userId,
              rating: dto.workerRating,
              status: 'published',
            }),
          );
          await this.recomputeWorkerRating(em, booking.workerId);
        }

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

  /**
   * Owner-only, within `review_edit_window_hours` of creation. Updates the Review row
   * and, when `workerRating` is present and the review already has a linked
   * WorkerRating, updates that too -- then recomputes both aggregates.
   */
  async update(userId: string, reviewId: string, dto: UpdateReviewDto): Promise<Review> {
    const review = await this.reviews.findOneBy({ id: reviewId });
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId) throw new ForbiddenException('شما مالک این نظر نیستید');
    if (review.status === 'withdrawn') throw new ForbiddenException('این نظر حذف شده است');
    await this.assertWithinEditWindow(review.createdAt);

    const workerRating = await this.workerRatings.findOneBy({ reviewId });
    if (dto.workerRating !== undefined && !workerRating) {
      throw new BadRequestException('این نظر شامل امتیاز کارمند نیست');
    }

    await this.dataSource.transaction(async (em) => {
      const patch: Partial<Pick<Review, 'rating' | 'comment'>> = {};
      if (dto.rating !== undefined) patch.rating = dto.rating;
      if (dto.comment !== undefined) patch.comment = dto.comment;
      if (Object.keys(patch).length) {
        await em.update(Review, { id: reviewId }, patch);
      }
      await this.recomputeSalonRating(em, review.salonId);

      if (dto.workerRating !== undefined && workerRating) {
        await em.update(WorkerRating, { id: workerRating.id }, { rating: dto.workerRating });
        await this.recomputeWorkerRating(em, workerRating.workerId);
      }
    });

    return (await this.reviews.findOneBy({ id: reviewId }))!;
  }

  /**
   * Owner-only, within the edit window -- soft-deletes via status -> 'withdrawn'
   * (reviews.status has no DB CHECK constraint, see review.entity.ts). The booking
   * stays permanently ineligible for a new review: reviews_booking_uidx is keyed on
   * booking_id regardless of status, so it's never re-usable even after withdrawal.
   * Cascades to the linked WorkerRating (if any) by flipping it to 'rejected' -- the
   * closest allowed value to "excluded from the aggregate" given worker_ratings.status
   * only allows published/rejected (see worker-rating.entity.ts).
   */
  async remove(userId: string, reviewId: string): Promise<void> {
    const review = await this.reviews.findOneBy({ id: reviewId });
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId !== userId) throw new ForbiddenException('شما مالک این نظر نیستید');
    if (review.status === 'withdrawn') throw new ForbiddenException('این نظر قبلا حذف شده است');
    await this.assertWithinEditWindow(review.createdAt);

    const workerRating = await this.workerRatings.findOneBy({ reviewId });

    await this.dataSource.transaction(async (em) => {
      await em.update(Review, { id: reviewId }, { status: 'withdrawn' });
      await this.recomputeSalonRating(em, review.salonId);

      if (workerRating) {
        await em.update(WorkerRating, { id: workerRating.id }, { status: 'rejected' });
        await this.recomputeWorkerRating(em, workerRating.workerId);
      }
    });
  }

  async moderateWorkerRating(id: string, status: 'published' | 'rejected'): Promise<WorkerRating> {
    const rating = await this.workerRatings.findOneBy({ id });
    if (!rating) throw new NotFoundException('Worker rating not found');

    // A worker rating's edit/delete lifecycle is always driven through its parent
    // Review, never independently (design spec §"Worker ratings"). remove() cascades a
    // customer's own deletion onto the rating as 'rejected' -- the only value
    // worker_ratings.status allows -- so the rating row on its own is indistinguishable
    // from an admin rejection; the parent's status is the only thing that tells them
    // apart. Without this guard, 'انتشار مجدد' would re-count a rating the customer
    // deleted back into workers.rating_avg/rating_count and the public list. Mirrors
    // moderate()'s guard on the review itself and is likewise the source of truth: it
    // must hold even if a client bypasses the admin-panel UI.
    const review = await this.reviews.findOneBy({ id: rating.reviewId });
    if (review?.status === 'withdrawn') {
      throw new ConflictException('نظر مربوط به این امتیاز توسط کاربر حذف شده و قابل تغییر وضعیت توسط مدیر نیست');
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(WorkerRating, { id }, { status });
      await this.recomputeWorkerRating(em, rating.workerId);
    });

    return (await this.workerRatings.findOneBy({ id }))!;
  }

  // Inclusive of the exact boundary instant -- `createdAt + windowHours` itself is
  // still editable, only strictly-after is rejected.
  private async assertWithinEditWindow(createdAt: Date): Promise<void> {
    const windowHours = await this.platformConfig.getReviewEditWindowHours();
    const deadline = createdAt.getTime() + windowHours * 60 * 60_000;
    if (Date.now() > deadline) {
      throw new ForbiddenException('مهلت ویرایش این نظر به پایان رسیده است');
    }
  }

  async findForSalon(salonId: string): Promise<Review[]> {
    // Public sub-resources of a salon 404 when the salon is not approved -- the same
    // policy PublicSalonContentController.requireSalonId() applies to the public
    // services/hours/photos listings via SalonsService.findPublicBySlug(). Without
    // this check, reviews of pending/suspended salons were publicly listable by id.
    const salon = await this.salons.findOneBy({ id: salonId, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return this.reviews.find({ where: { salonId, status: 'published' }, order: { createdAt: 'DESC' } });
  }

  async listForAdmin(query: {
    salonId?: string;
    salonName?: string;
    status?: 'published' | 'rejected';
    rating?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<Review & { workerRating: { score: number; workerName: string } | null; salonName: string }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // salonId (exact) wins over salonName (fuzzy) if both are somehow present -- the
    // admin-panel UI only ever sends one of the two. A salonName search resolves to a
    // set of salon ids first (mirrors AdminSalonsController's own `name ILIKE` filter)
    // rather than a query-builder join, since every other filter here is already a
    // plain Repository `where` object.
    if (query.salonId) {
      where.salonId = query.salonId;
    } else if (query.salonName) {
      const matches = await this.salons.find({ where: { name: ILike(`%${query.salonName}%`) }, select: ['id'] });
      if (matches.length === 0) {
        return { items: [], total: 0, page, pageSize };
      }
      where.salonId = In(matches.map((s) => s.id));
    }

    const [items, total] = await this.reviews.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Admin panel's review moderation screen displays the linked worker rating (if
    // any) alongside the salon rating in each row (design spec §8) -- fetched here in
    // two small batched queries scoped to just this page's review ids, rather than a
    // per-row round trip. Salon name is batched the same way, mirroring
    // listWorkerRatingsForAdmin() below -- the moderation queue is otherwise unusable
    // for an operator with no idea which salon a review is about.
    const reviewIds = items.map((r) => r.id);
    const ratings = reviewIds.length ? await this.workerRatings.find({ where: { reviewId: In(reviewIds) } }) : [];
    const workerIds = [...new Set(ratings.map((r) => r.workerId))];
    const workerRows = workerIds.length ? await this.workers.find({ where: { id: In(workerIds) } }) : [];
    const workerNameById = new Map(workerRows.map((w) => [w.id, w.name]));
    const ratingByReviewId = new Map(ratings.map((r) => [r.reviewId, r]));

    const salonIds = [...new Set(items.map((r) => r.salonId))];
    const salonRows = salonIds.length ? await this.salons.find({ where: { id: In(salonIds) } }) : [];
    const salonNameById = new Map(salonRows.map((s) => [s.id, s.name]));

    return {
      items: items.map((review) => {
        const wr = ratingByReviewId.get(review.id);
        return {
          ...review,
          workerRating: wr ? { score: wr.rating, workerName: workerNameById.get(wr.workerId) ?? 'Unknown worker' } : null,
          salonName: salonNameById.get(review.salonId) ?? 'Unknown salon',
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  // Backs the admin-panel's dedicated Worker Ratings Moderation screen (design spec
  // §8: "mirrors the existing Reviews moderation screen exactly"). Same
  // filter/paginate shape as listForAdmin, with workerName/salonName joined in for
  // display since the raw WorkerRating row only carries ids.
  async listWorkerRatingsForAdmin(query: {
    salonId?: string;
    status?: 'published' | 'rejected';
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<WorkerRating & { workerName: string; salonName: string; reviewStatus: ReviewStatus }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where: Record<string, unknown> = {};
    if (query.salonId) where.salonId = query.salonId;
    if (query.status) where.status = query.status;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.workerRatings.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const workerIds = [...new Set(items.map((r) => r.workerId))];
    const salonIds = [...new Set(items.map((r) => r.salonId))];
    const reviewIds = [...new Set(items.map((r) => r.reviewId))];
    const [workerRows, salonRows, reviewRows] = await Promise.all([
      workerIds.length ? this.workers.find({ where: { id: In(workerIds) } }) : Promise.resolve([]),
      salonIds.length ? this.salons.find({ where: { id: In(salonIds) } }) : Promise.resolve([]),
      reviewIds.length ? this.reviews.find({ where: { id: In(reviewIds) } }) : Promise.resolve([]),
    ]);
    const workerNameById = new Map(workerRows.map((w) => [w.id, w.name]));
    const salonNameById = new Map(salonRows.map((s) => [s.id, s.name]));
    const reviewStatusById = new Map(reviewRows.map((r) => [r.id, r.status]));

    return {
      // reviewStatus is what lets the admin panel tell a customer's own deletion
      // (parent review 'withdrawn', cascaded here as 'rejected') apart from a genuine
      // admin rejection, and render the former as a non-actionable notice instead of a
      // live 'انتشار مجدد' button that moderateWorkerRating() would 409 anyway.
      // Defaults to 'published' (i.e. "not withdrawn") if the parent somehow can't be
      // read, matching that guard's own permissive branch rather than locking a row.
      items: items.map((r) => ({
        ...r,
        workerName: workerNameById.get(r.workerId) ?? 'Unknown worker',
        salonName: salonNameById.get(r.salonId) ?? 'Unknown salon',
        reviewStatus: reviewStatusById.get(r.reviewId) ?? 'published',
      })),
      total,
      page,
      pageSize,
    };
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
    // A 'withdrawn' review is a customer's own soft-delete (DELETE /api/reviews/:id),
    // not an admin moderation state -- there is no admin action that should be able to
    // flip it back to 'published' (that would silently resurrect content the customer
    // explicitly deleted) or to 'rejected' (it's already excluded from the aggregate).
    // The admin-panel's ModerateReviewButton already hides its controls entirely for a
    // withdrawn review, but this guard is the actual source of truth: it must hold even
    // if a client bypasses that UI.
    if (review.status === 'withdrawn') {
      throw new ConflictException('این نظر توسط کاربر حذف شده و قابل تغییر وضعیت توسط مدیر نیست');
    }

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

  // Same lock-then-read-then-write shape as recomputeSalonRating (see its comment for
  // why a single UPDATE...FROM(subquery) would race) -- mirrored onto workers instead
  // of salons.
  private async recomputeWorkerRating(em: EntityManager, workerId: string): Promise<void> {
    await em.query(`SELECT id FROM workers WHERE id = $1 FOR UPDATE`, [workerId]);
    const [{ avg_rating, rating_count }] = await em.query(
      `SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating, COUNT(*)::int AS rating_count
       FROM worker_ratings
       WHERE worker_id = $1 AND status = 'published'`,
      [workerId],
    );
    await em.query(`UPDATE workers SET rating_avg = $2, rating_count = $3 WHERE id = $1`, [
      workerId,
      avg_rating,
      rating_count,
    ]);
  }
}
