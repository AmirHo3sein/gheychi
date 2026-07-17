import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { Booking } from '../booking/booking.entity';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Review } from '../reviews/review.entity';
import { PortfolioItem } from '../salons/portfolio-item.entity';
import { SalonStory } from '../salons/salon-story.entity';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, CreateReportDto, ResolveReportDto } from './dto/report.dto';
import { Report, ReportStatus, ReportTargetType } from './report.entity';

export interface AdminReportListItem {
  id: string;
  reporterId: string;
  salonId: string;
  reviewId: string | null;
  storyId: string | null;
  portfolioItemId: string | null;
  targetType: ReportTargetType;
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
  storyUrl: string | null;
  storyCaption: string | null;
  portfolioItemUrl: string | null;
  portfolioItemCaption: string | null;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolioItems: Repository<PortfolioItem>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  async create(reporterId: string, dto: CreateReportDto): Promise<Report> {
    // Blank/whitespace target ids are treated as absent. The DTO's @ValidateIf set
    // skips @IsUUID on a target whenever a sibling is present, so e.g.
    // { salonId: '<valid>', reviewId: '' } reaches here — without normalization the
    // empty string would be inserted into the uuid review_id column and surface as a
    // raw Postgres 22P02 (500). Normalized values feed the exactly-one check, the
    // salon derivation, and the insert.
    const rawSalonId = typeof dto.salonId === 'string' ? dto.salonId.trim() || null : null;
    const rawReviewId = typeof dto.reviewId === 'string' ? dto.reviewId.trim() || null : null;
    const rawStoryId = typeof dto.storyId === 'string' ? dto.storyId.trim() || null : null;
    const rawPortfolioItemId = typeof dto.portfolioItemId === 'string' ? dto.portfolioItemId.trim() || null : null;

    // The DTO's @ValidateIf set guarantees "at least one" target; "exactly one" is
    // completed here (any multi-target combination skips every DTO branch by design).
    const targetCount =
      (rawSalonId ? 1 : 0) + (rawReviewId ? 1 : 0) + (rawStoryId ? 1 : 0) + (rawPortfolioItemId ? 1 : 0);
    if (targetCount !== 1) {
      throw new BadRequestException('دقیقاً یکی از سالن، دیدگاه، استوری یا نمونه کار باید به‌عنوان هدف گزارش مشخص شود');
    }

    // Deliberate: targets are not filtered by salon status or content moderation state.
    // A completed booking grants standing, and reports about suspended salons,
    // rejected reviews, or removed/expired stories still carry signal for admins.
    // salon_id stays NOT NULL: review/story/portfolio targets derive it here, so every
    // report is salon-anchored and the admin salon filter aggregates all four kinds.
    let salonId = rawSalonId;
    const reviewId = rawReviewId;
    const storyId = rawStoryId;
    const portfolioItemId = rawPortfolioItemId;
    if (reviewId) {
      const review = await this.reviews.findOneBy({ id: reviewId });
      if (!review) throw new NotFoundException('Review not found');
      salonId = review.salonId;
    }
    if (storyId) {
      const story = await this.stories.findOneBy({ id: storyId });
      if (!story) throw new NotFoundException('Story not found');
      salonId = story.salonId;
    }
    if (portfolioItemId) {
      const item = await this.portfolioItems.findOneBy({ id: portfolioItemId });
      if (!item) throw new NotFoundException('Portfolio item not found');
      salonId = item.salonId;
    }

    if (!(await this.canReport(reporterId, salonId!))) {
      throw new ForbiddenException('فقط مشتریانی که نوبت تکمیل‌شده در این سالن داشته‌اند می‌توانند گزارش ثبت کنند');
    }

    // Derived from the resolved target, never client-supplied: this discriminator
    // survives the ON DELETE SET NULL cascade on story/portfolio FKs, so an orphaned
    // content report stays distinguishable from a salon report (admin UI placeholder)
    // and falls out of the open-report dedup index (no 23505 on provider deletes).
    const targetType: ReportTargetType = reviewId
      ? 'review'
      : storyId
        ? 'story'
        : portfolioItemId
          ? 'portfolio'
          : 'salon';

    try {
      // Insert + notification are atomic: emit() writes through this transaction's
      // manager (spec §3.3), so a duplicate-report rollback never leaves a stray
      // notification, and a failed notification insert rolls the report back. This is
      // intentionally NOT the fire-safe pattern used for salon_resubmitted — here the
      // transaction boundary is the contract.
      return await this.dataSource.transaction(async (em) => {
        const report = await em.save(
          Report,
          em.create(Report, {
            reporterId,
            salonId: salonId!,
            reviewId,
            storyId,
            portfolioItemId,
            targetType,
            reason: dto.reason,
            status: 'open',
          }),
        );
        await this.adminNotifications.emit('report_created', 'گزارش جدید ثبت شد', dto.reason, '/reports', em);
        return report;
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
      .leftJoin(SalonStory, 'story', 'story.id = report.storyId')
      .leftJoin(PortfolioItem, 'portfolioItem', 'portfolioItem.id = report.portfolioItemId')
      .select('report.id', 'id')
      .addSelect('report.reporterId', 'reporterId')
      .addSelect('report.salonId', 'salonId')
      .addSelect('report.reviewId', 'reviewId')
      .addSelect('report.storyId', 'storyId')
      .addSelect('report.portfolioItemId', 'portfolioItemId')
      .addSelect('report.targetType', 'targetType')
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
      // Nullable by construction: populated only for story/portfolio-targeted reports
      // whose target row still exists (ON DELETE SET NULL nulls the FK when a provider
      // deletes the content or GC collects an expired story).
      .addSelect('story.url', 'storyUrl')
      .addSelect('story.caption', 'storyCaption')
      .addSelect('portfolioItem.url', 'portfolioItemUrl')
      .addSelect('portfolioItem.caption', 'portfolioItemCaption')
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
