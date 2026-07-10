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
    // The DTO's @ValidateIf pair guarantees "at least one" target; "exactly one" is
    // completed here (both-provided skips both DTO branches by design).
    if ((dto.salonId ? 1 : 0) + (dto.reviewId ? 1 : 0) !== 1) {
      throw new BadRequestException('دقیقاً یکی از سالن یا دیدگاه باید به‌عنوان هدف گزارش مشخص شود');
    }

    let salonId = dto.salonId ?? null;
    const reviewId = dto.reviewId ?? null;
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
