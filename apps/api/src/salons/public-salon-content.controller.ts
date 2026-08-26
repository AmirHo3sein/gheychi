import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { iranDateString } from '../common/iran-time.util';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ListWorkersQueryDto, WorkerRatingsQueryDto } from './dto/worker.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { ScheduleException } from './schedule-exception.entity';
import { SalonService } from './salon-service.entity';
import { SalonPhoto } from './salon-photo.entity';
import { SalonStory } from './salon-story.entity';
import { SalonsService } from './salons.service';
import { Worker } from './worker.entity';
import { WorkerEligibilityService } from './worker-eligibility.service';
import { WorkerRating } from '../reviews/worker-rating.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/:slug')
@Public()
export class PublicSalonContentController {
  constructor(
    private readonly salonsService: SalonsService,
    private readonly workerEligibility: WorkerEligibilityService,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolio: Repository<PortfolioItem>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerRating) private readonly workerRatings: Repository<WorkerRating>,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  private async requireSalonId(slug: string): Promise<string> {
    const salon = await this.salonsService.findPublicBySlug(slug);
    return salon.id;
  }

  @Get('services')
  async listServices(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.services.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Get('hours')
  async listHours(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.hours.find({ where: { salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Get('exceptions')
  async listExceptions(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    // Future-dated only (today included) -- a past closure is no longer useful information
    // for a customer deciding whether/when to book. Postgres's own CURRENT_DATE would
    // evaluate in the DB session's timezone (UTC here, per docker-compose.yml -- no TZ is
    // set), which disagrees with Iran's fixed UTC+3:30 offset for the first 3.5 hours of
    // every Iran-local day; iranDateString is the same Iran-calendar-day logic the
    // availability computation itself uses, so this stays correct regardless of the DB's
    // own timezone.
    const today = iranDateString(new Date());
    const rows = await this.exceptions
      .createQueryBuilder('exception')
      .where('exception.salon_id = :salonId', { salonId })
      .andWhere('exception.date >= :today', { today })
      // A single worker's day off must never read as the whole salon being closed here.
      .andWhere('exception.worker_id IS NULL')
      .orderBy('exception.date', 'ASC')
      .getMany();
    // isClosed isn't exposed -- every row here is one (schedule.controller.ts's addException
    // defaults it true and nothing in this app can create a false one), so it would only add
    // a field public callers have no real use for.
    return rows.map(({ date, startTime, endTime, reason }) => ({ date, startTime, endTime, reason }));
  }

  @Get('photos')
  async listPhotos(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.photos.find({ where: { salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }

  @Get('stories')
  async listStories(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    const { storiesEnabled } = await this.platformConfig.getFeatureFlags();
    // Gated here, not only via a frontend v-if -- a direct API call must see the same
    // empty result the hidden UI implies. Provider-panel management stays functional
    // regardless (see salon-stories.controller.ts), only the public read is affected.
    if (!storiesEnabled) return [];
    // Expiry is a DB-clock predicate (the same clock that stamped expires_at at
    // insert), so a story vanishes at exactly 24h with no cron or app-clock drift.
    const rows = await this.stories
      .createQueryBuilder('story')
      .where('story.salon_id = :salonId', { salonId })
      .andWhere("story.status = 'published'")
      .andWhere('story.expires_at > now()')
      .orderBy('story.created_at', 'ASC')
      .getMany();
    return rows.map(({ id, url, caption, serviceId, createdAt, expiresAt }) => ({
      id, url, caption, serviceId, createdAt, expiresAt,
    }));
  }

  @Get('portfolio')
  async listPortfolio(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    const { portfolioEnabled } = await this.platformConfig.getFeatureFlags();
    if (!portfolioEnabled) return [];
    const rows = await this.portfolio.find({
      where: { salonId, status: 'published' },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(({ id, url, caption, serviceId, sortOrder }) => ({ id, url, caption, serviceId, sortOrder }));
  }

  @Get('workers')
  async listWorkers(@Param('slug') slug: string, @Query() query: ListWorkersQueryDto) {
    const salonId = await this.requireSalonId(slug);
    const qb = this.workers
      .createQueryBuilder('worker')
      .where('worker.salon_id = :salonId', { salonId })
      .andWhere('worker.active = true')
      .orderBy('worker.created_at', 'ASC');
    if (query.serviceId) {
      this.workerEligibility.applyEligibilityFilter(qb, query.serviceId);
    }
    const rows = await qb.getMany();
    return rows.map(({ id, name, ratingAvg, ratingCount, createdAt }) => ({
      id, name, ratingAvg: Number(ratingAvg), ratingCount, createdAt,
    }));
  }

  @Get('workers/:id/ratings')
  async listWorkerRatings(
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WorkerRatingsQueryDto,
  ) {
    const salonId = await this.requireSalonId(slug);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.workerRatings.findAndCount({
      where: { workerId: id, salonId, status: 'published' },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }
}
