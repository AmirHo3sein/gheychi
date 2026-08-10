import { Body, ConflictException, Controller, Delete, HttpCode, Inject, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
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
    return this.categories.findOneBy({ id });
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.delete', 'category')
  async remove(@Param('id', ParseIntPipe) id: number) {
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
