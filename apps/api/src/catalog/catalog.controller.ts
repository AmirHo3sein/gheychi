import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCategory } from './service-category.entity';

@Controller('categories')
export class CatalogController {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
  ) {}

  @Get()
  list() {
    return this.categories.find({ order: { id: 'ASC' } });
  }
}
