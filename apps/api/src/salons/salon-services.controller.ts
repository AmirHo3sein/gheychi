import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { SalonServicesService } from './salon-services.service';

@Controller('salons/mine/services')
@UseGuards(SalonOwnerGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly salonServicesService: SalonServicesService,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    return this.salonServicesService.create(req.salonId!, dto);
  }

  @Get()
  async list(@Req() req: Request) {
    return this.services.find({ where: { salonId: req.salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.salonServicesService.update(req.salonId!, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.services.update({ id, salonId: req.salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }
}
