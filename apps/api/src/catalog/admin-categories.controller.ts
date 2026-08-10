import { Body, ConflictException, Controller, Delete, HttpCode, Inject, NotFoundException, Param, ParseIntPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { REDIS } from '../redis/redis.module';
import { CATEGORIES_CACHE_KEY } from './categories-cache.util';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { ServiceCategory } from './service-category.entity';

@Controller('admin/categories')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminCategoriesController {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.create', 'category')
  async create(@Body() dto: CreateCategoryDto) {
    try {
      const created = await this.categories.save(this.categories.create(dto));
      await this.redis.del(CATEGORIES_CACHE_KEY);
      return created;
    } catch (err) {
      // Persian: this message is surfaced verbatim by the admin panel's toast, same as the
      // in-use message on delete below.
      if (isUniqueViolation(err)) throw new ConflictException('دسته‌بندی‌ای با این نام از قبل وجود دارد');
      throw err;
    }
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.update', 'category')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Left unset
    // (falls back to the raw request body) when the category doesn't exist -- the
    // update below still 404s exactly as before, this fetch just can't contribute a
    // "before" snapshot in that case.
    const before = await this.categories.findOneBy({ id });
    if (before) req.auditBefore = { name: before.name, icon: before.icon };

    let result;
    try {
      result = await this.categories.update({ id }, dto);
    } catch (err) {
      // Persian: this message is surfaced verbatim by the admin panel's toast, same as the
      // in-use message on delete below.
      if (isUniqueViolation(err)) throw new ConflictException('دسته‌بندی‌ای با این نام از قبل وجود دارد');
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
    await this.redis.del(CATEGORIES_CACHE_KEY);
    const updated = await this.categories.findOneBy({ id });
    if (updated) req.auditAfter = { name: updated.name, icon: updated.icon };
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.delete', 'category')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    // Real "before" snapshot for AuditInterceptor (see its doc comment). A hard delete
    // has no post-write state to report (req.auditAfter stays unset -> null), so this
    // is the only record of what the row looked like right before it was removed --
    // DELETE requests carry no body, so without this the payload would otherwise be
    // bare `null`.
    const before = await this.categories.findOneBy({ id });
    if (before) req.auditBefore = { name: before.name, icon: before.icon };

    let result;
    try {
      result = await this.categories.delete({ id });
    } catch (err) {
      // No pre-check by design: salon_services.category_id REFERENCES service_categories(id)
      // (NO ACTION) makes Postgres the source of truth for "in use".
      if (isForeignKeyViolation(err)) {
        throw new ConflictException('این دسته‌بندی توسط خدمات سالن‌ها استفاده می‌شود و قابل حذف نیست');
      }
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
    await this.redis.del(CATEGORIES_CACHE_KEY);
  }
}
