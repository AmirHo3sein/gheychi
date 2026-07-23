import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRatingsQueryDto } from './dto/worker.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonService } from './salon-service.entity';
import { SalonPhoto } from './salon-photo.entity';
import { SalonStory } from './salon-story.entity';
import { SalonsService } from './salons.service';
import { Worker } from './worker.entity';
import { WorkerRating } from '../reviews/worker-rating.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/:slug')
export class PublicSalonContentController {
  constructor(
    private readonly salonsService: SalonsService,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolio: Repository<PortfolioItem>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerRating) private readonly workerRatings: Repository<WorkerRating>,
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

  @Get('photos')
  async listPhotos(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.photos.find({ where: { salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }

  @Get('stories')
  async listStories(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
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
    const rows = await this.portfolio.find({
      where: { salonId, status: 'published' },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(({ id, url, caption, serviceId, sortOrder }) => ({ id, url, caption, serviceId, sortOrder }));
  }

  @Get('workers')
  async listWorkers(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    const rows = await this.workers.find({ where: { salonId, active: true }, order: { createdAt: 'ASC' } });
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
