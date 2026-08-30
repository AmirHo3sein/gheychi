import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { UpdateSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { UpdateHandleDto } from './dto/salon-handle.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

@Controller('admin/salons')
@UseGuards(RolesGuard)
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
      // Oldest-pending-first: this is a moderation queue, so admins should clear the
      // longest-waiting requests first rather than see them alphabetically by name.
      .orderBy('salon.createdAt', 'ASC');

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
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalonStatusDto, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Left
    // unset (falls back to the raw request body) when the salon doesn't exist --
    // SalonsService.setStatus below still owns the 404, this fetch just can't
    // contribute a "before" snapshot in that case. Deliberately not touching
    // salons.service.ts itself here (see task scope note on concurrent edits).
    const before = await this.salons.findOneBy({ id });
    if (before) {
      req.auditBefore = { status: before.status, rejectionReason: before.rejectionReason, suspendedCause: before.suspendedCause };
    }

    const updated = await this.salonsService.setStatus(id, dto);
    req.auditAfter = { status: updated.status, rejectionReason: updated.rejectionReason, suspendedCause: updated.suspendedCause };
    return updated;
  }

  @Patch(':id/featured')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.featured.set', 'salon')
  setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    return this.salonsService.setFeatured(id, dto);
  }

  // Admin override of a salon's own handle -- the same route the owner has
  // (PATCH /salons/mine/handle) reused here for recourse if a salon picks something
  // inappropriate, not a separate feature.
  @Patch(':id/handle')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.handle.set', 'salon')
  async setHandle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHandleDto, @Req() req: Request) {
    const before = await this.salons.findOneBy({ id });
    if (before) req.auditBefore = { slug: before.slug };

    const updated = await this.salonsService.updateHandle(id, dto.handle);
    req.auditAfter = { slug: updated.slug };
    return updated;
  }

  private async requireSalon(id: string): Promise<void> {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
  }
}
