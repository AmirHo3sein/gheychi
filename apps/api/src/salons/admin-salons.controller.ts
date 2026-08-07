import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { UpdateSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolioItems: Repository<PortfolioItem>,
    private readonly salonsService: SalonsService,
  ) {}

  @Get()
  async list(@Query() query: AdminSalonQueryDto) {
    const qb = this.salons
      .createQueryBuilder('salon')
      .select(['salon.id', 'salon.name', 'salon.city', 'salon.status', 'salon.genderTarget', 'salon.isFeatured', 'salon.featuredUntil', 'salon.createdAt'])
      .orderBy('salon.name', 'ASC');

    const status = query.status ?? 'pending';
    if (status !== 'all') qb.andWhere('salon.status = :status', { status });

    if (query.city) qb.andWhere('salon.city ILIKE :city', { city: `%${query.city}%` });
    if (query.name) qb.andWhere('salon.name ILIKE :name', { name: `%${query.name}%` });
    if (query.genderTarget) qb.andWhere('salon.genderTarget = :genderTarget', { genderTarget: query.genderTarget });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
    return salon;
  }

  // Moderation views: ALL rows, including removed and expired ones — the public
  // approved-only gate does not apply here, so an admin can inspect the content of a
  // pending/suspended salon and the evidence behind a report on already-hidden rows.
  @Get(':id/stories')
  async listStories(@Param('id', ParseUUIDPipe) id: string) {
    await this.requireSalon(id);
    return this.stories.find({ where: { salonId: id }, order: { createdAt: 'ASC' } });
  }

  @Get(':id/portfolio')
  async listPortfolio(@Param('id', ParseUUIDPipe) id: string) {
    await this.requireSalon(id);
    return this.portfolioItems.find({ where: { salonId: id }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  // Business logic (validation, transitions, the owner-suspended approval guard) lives in
  // SalonsService — this handler's only job is to receive the request and delegate.
  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.status.set', 'salon')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalonStatusDto) {
    return this.salonsService.setStatus(id, dto);
  }

  @Patch(':id/featured')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.featured.set', 'salon')
  setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    return this.salonsService.setFeatured(id, dto);
  }

  private async requireSalon(id: string): Promise<void> {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
  }
}
