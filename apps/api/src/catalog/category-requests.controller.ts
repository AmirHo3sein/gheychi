import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { User } from '../users/user.entity';
import { CategoryRequestsService } from './category-requests.service';
import { CreateCategoryRequestDto } from './dto/category-request.dto';

@Controller('salons/mine/category-requests')
@UseGuards(SalonOwnerGuard)
export class CategoryRequestsController {
  constructor(private readonly categoryRequests: CategoryRequestsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.categoryRequests.listForSalon(req.salonId!);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateCategoryRequestDto) {
    return this.categoryRequests.createForSalon((req.user as User).id, req.salonId!, dto);
  }
}
