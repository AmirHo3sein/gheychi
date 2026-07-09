import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { AdminSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

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

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.status.set', 'salon')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSalonStatusDto) {
    const result = await this.salons.update(
      { id },
      { status: dto.status, rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null) },
    );
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
}
