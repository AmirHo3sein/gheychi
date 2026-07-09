import { Body, ConflictException, Controller, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { ServiceCategory } from './service-category.entity';

@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminCategoriesController {
  constructor(@InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category.create', 'category')
  async create(@Body() dto: CreateCategoryDto) {
    try {
      return await this.categories.save(this.categories.create(dto));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
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
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
    return this.categories.findOneBy({ id });
  }
}
