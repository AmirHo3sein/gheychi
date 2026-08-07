import { Controller, Get, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { CATEGORIES_CACHE_KEY, CATEGORIES_CACHE_TTL_SEC } from './categories-cache.util';
import { ServiceCategory } from './service-category.entity';

@Controller('categories')
export class CatalogController {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Public, parameter-less, identical response for every caller -- hit on nearly every
  // salon/service browse or filter-by-category page load. AdminCategoriesController
  // invalidates this same key on any create/update/delete, so a change is reflected on
  // the next request rather than waiting out the TTL (a plain safety net here, same
  // reasoning as PlatformConfigService's cache).
  @Get()
  async list(): Promise<ServiceCategory[]> {
    const cached = await this.redis.get(CATEGORIES_CACHE_KEY);
    if (cached !== null) return JSON.parse(cached) as ServiceCategory[];

    const rows = await this.categories.find({ order: { id: 'ASC' } });
    await this.redis.set(CATEGORIES_CACHE_KEY, JSON.stringify(rows), 'EX', CATEGORIES_CACHE_TTL_SEC);
    return rows;
  }
}
