import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Review } from '../reviews/review.entity';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, CreateReportDto, ResolveReportDto } from './dto/report.dto';
import { Report, ReportStatus } from './report.entity';

export interface AdminReportListItem {
  id: string;
  reporterId: string;
  salonId: string;
  reviewId: string | null;
  reason: string;
  status: ReportStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  salonName: string;
  salonSlug: string;
  reporterPhone: string;
  reviewRating: number | null;
  reviewComment: string | null;
}

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
    const rawSalonId = typeof dto.salonId === 'string' ? dto.salonId.trim() || null : null;
    const rawReviewId = typeof dto.reviewId === 'string' ? dto.reviewId.trim() || null : null;

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

  async listForAdmin(query: AdminReportQueryDto): Promise<{
    items: AdminReportListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const status = query.status ?? 'open';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // No relation decorators anywhere in this repo (FKs live only in the migration SQL),
    // so context columns come from explicit entity-class joins + raw per-column aliases.
    const qb = this.reports
      .createQueryBuilder('report')
      .leftJoin(Salon, 'salon', 'salon.id = report.salonId')
      .leftJoin(User, 'reporter', 'reporter.id = report.reporterId')
      .leftJoin(Review, 'review', 'review.id = report.reviewId')
      .select('report.id', 'id')
      .addSelect('report.reporterId', 'reporterId')
      .addSelect('report.salonId', 'salonId')
      .addSelect('report.reviewId', 'reviewId')
      .addSelect('report.reason', 'reason')
      .addSelect('report.status', 'status')
      .addSelect('report.resolutionNote', 'resolutionNote')
      .addSelect('report.resolvedBy', 'resolvedBy')
      .addSelect('report.resolvedAt', 'resolvedAt')
      .addSelect('report.createdAt', 'createdAt')
      .addSelect('salon.name', 'salonName')
      .addSelect('salon.slug', 'salonSlug')
      .addSelect('reporter.phone', 'reporterPhone')
      .addSelect('review.rating', 'reviewRating')
      .addSelect('review.comment', 'reviewComment')
      .orderBy('report.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    if (status !== 'all') qb.andWhere('report.status = :status', { status });
    if (query.salonId) qb.andWhere('report.salonId = :salonId', { salonId: query.salonId });

    const countWhere: FindOptionsWhere<Report> = {};
    if (status !== 'all') countWhere.status = status;
    if (query.salonId) countWhere.salonId = query.salonId;

    const [items, total] = await Promise.all([
      qb.getRawMany<AdminReportListItem>(),
      this.reports.count({ where: countWhere }),
    ]);
    return { items, total, page, pageSize };
  }

  async resolve(adminId: string, reportId: string, dto: ResolveReportDto): Promise<Report> {
    const report = await this.reports.findOneBy({ id: reportId });
    if (!report) throw new NotFoundException('Report not found');

    // Conditional update on status='open' — the same lost-race guard as
    // SalonsService.resubmitMine(): a concurrent admin who closed this report first
    // means this write affects 0 rows and the loser gets a clear 409 instead of
    // silently clobbering the winner's resolution.
    const result = await this.reports.update(
      { id: reportId, status: 'open' },
      { status: dto.status, resolutionNote: dto.note ?? null, resolvedBy: adminId, resolvedAt: new Date() },
    );
    if (!result.affected) {
      throw new ConflictException('این گزارش قبلاً بررسی شده است');
    }
    return (await this.reports.findOneBy({ id: reportId }))!;
  }
}
