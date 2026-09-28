import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { QueryFailedError, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { CreateCustomCategoryDto } from './dto/salon-custom-category.dto';
import { SalonCustomCategory } from './salon-custom-category.entity';
import { SalonOwnerGuard } from './salon-owner.guard';

// Salon-private categories: created and usable immediately, no admin approval round-trip
// (that's what CategoryRequest/category-requests is for, and it grows the GLOBAL list --
// this deliberately never does). Simple CRUD, no cross-entity business logic beyond what
// the DB's own FK/unique constraints already enforce, so this stays controller-only per
// this codebase's "simple CRUD may skip the service layer" convention.
@Controller('salons/mine/custom-categories')
@UseGuards(SalonOwnerGuard)
export class SalonCustomCategoriesController {
  constructor(
    @InjectRepository(SalonCustomCategory) private readonly categories: Repository<SalonCustomCategory>,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateCustomCategoryDto) {
    try {
      return await this.categories.save(this.categories.create({ ...dto, salonId: req.salonId }));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('دسته‌بندی سفارشی با این نام قبلاً ثبت شده است');
      throw err;
    }
  }

  @Get()
  async list(@Req() req: Request) {
    return this.categories.find({ where: { salonId: req.salonId }, order: { createdAt: 'ASC' } });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    try {
      const result = await this.categories.delete({ id, salonId: req.salonId });
      if (!result.affected) throw new NotFoundException();
    } catch (err) {
      if (err instanceof QueryFailedError && isForeignKeyViolation(err)) {
        throw new ConflictException('این دسته‌بندی توسط خدماتی از سالن شما استفاده می‌شود و قابل حذف نیست');
      }
      throw err;
    }
  }
}
