import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from '../users/users.service';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { AdminSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolioItems: Repository<PortfolioItem>,
    private readonly users: UsersService,
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

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.status.set', 'salon')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSalonStatusDto) {
    if (dto.status === 'approved') {
      const salon = await this.salons.findOneBy({ id });
      if (!salon) throw new NotFoundException();
      const owner = await this.users.findById(salon.ownerId);
      if (owner?.status === 'suspended') {
        // Persian: this message is surfaced verbatim by the admin panel's toast.
        throw new ConflictException('تایید این آرایشگاه ممکن نیست؛ حساب مالک آن معلق است');
      }
    }
    const patch: Partial<Salon> = {
      status: dto.status,
      rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null),
    };
    // suspended_cause bookkeeping (Plan 7 spec 3.5): a direct admin suspension is marked
    // 'admin' so a later owner reactivation will NOT auto-restore this salon; approving
    // (from any prior state) clears the cause. Rejection leaves it untouched — so a
    // rejected/pending salon may carry a stale 'owner_suspended' cause until its next
    // approve/suspend scrubs it. Harmless: the reactivation cascade also requires
    // status='suspended', so a stale cause on any other status can never trigger a restore.
    if (dto.status === 'suspended') patch.suspendedCause = 'admin';
    if (dto.status === 'approved') patch.suspendedCause = null;
    const result = await this.salons.update({ id }, patch);
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }

  @Patch(':id/featured')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.featured.set', 'salon')
  async setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    const result = await this.salons.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }

  private async requireSalon(id: string): Promise<void> {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
  }
}
