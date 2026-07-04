import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';

@Controller('salons/mine/services')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    return this.services.save(this.services.create({ ...dto, salonId: req.salonId }));
  }

  @Get()
  async list(@Req() req: Request) {
    return this.services.find({ where: { salonId: req.salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    const service = await this.services.findOneBy({ id, salonId: req.salonId, isActive: true });
    if (!service) throw new NotFoundException();
    Object.assign(service, dto);
    return this.services.save(service);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.services.update({ id, salonId: req.salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }
}
