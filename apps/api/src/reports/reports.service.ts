import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Review } from '../reviews/review.entity';
import { CreateReportDto } from './dto/report.dto';
import { Report } from './report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<Report> {
    // Blank/whitespace target ids are treated as absent. The DTO's @ValidateIf pair
    // skips @IsUUID on a target whenever its sibling is present, so e.g.
    // { salonId: '<valid>', reviewId: '' } reaches here — without normalization the
    // empty string would be inserted into the uuid review_id column and surface as a
    // raw Postgres 22P02 (500). Normalized values feed the exactly-one check, the
    // review derivation, and the insert.
    const rawSalonId = dto.salonId?.trim() || null;
    const rawReviewId = dto.reviewId?.trim() || null;

    // The DTO's @ValidateIf pair guarantees "at least one" target; "exactly one" is
    // completed here (both-provided skips both DTO branches by design).
    if ((rawSalonId ? 1 : 0) + (rawReviewId ? 1 : 0) !== 1) {
      throw new BadRequestException('دقیقاً یکی از سالن یا دیدگاه باید به‌عنوان هدف گزارش مشخص شود');
    }

    // Deliberate: targets are not filtered by salon status or review moderation state.
    // A completed booking grants standing, and reports about suspended salons or
    // rejected reviews still carry signal for admins.
    let salonId = rawSalonId;
    const reviewId = rawReviewId;
    if (reviewId) {
      const review = await this.reviews.findOneBy({ id: reviewId });
      if (!review) throw new NotFoundException('Review not found');
      salonId = review.salonId;
    }

    if (!(await this.canReport(reporterId, salonId!))) {
      throw new ForbiddenException('فقط مشتریانی که نوبت تکمیل‌شده در این سالن داشته‌اند می‌توانند گزارش ثبت کنند');
    }

    try {
      // A transaction for a single insert today — Task 12 adds the report_created
      // admin-notification emit into this same transaction, per the design spec §3.3.
      return await this.dataSource.transaction(async (em) => {
        return em.save(
          Report,
          em.create(Report, {
            reporterId,
            salonId: salonId!,
            reviewId,
            reason: dto.reason,
            status: 'open',
          }),
        );
      });
    } catch (err) {
      // The partial unique index reports_open_target_uidx (one OPEN report per reporter
      // per target) is the duplicate check's source of truth — same 23505-translation
      // idiom as ReviewsService.create().
      if (isUniqueViolation(err)) {
        throw new ConflictException('گزارش قبلی شما هنوز در حال بررسی است');
      }
      throw err;
    }
  }

  async canReport(userId: string, salonId: string): Promise<boolean> {
    const completed = await this.bookings.countBy({ userId, salonId, status: 'completed' });
    return completed > 0;
  }
}
