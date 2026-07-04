import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonService } from './salon-service.entity';
import { SalonsService } from './salons.service';

@Controller('salons/mine/services')
@UseGuards(AuthGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly salons: SalonsService,
  ) {}

  private async mySalonId(req: Request): Promise<string> {
    return (await this.salons.findMine((req.user as User).id)).id;
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    const salonId = await this.mySalonId(req);
    return this.services.save(this.services.create({ ...dto, salonId }));
  }

  @Get()
  async list(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.services.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    const salonId = await this.mySalonId(req);
    const service = await this.services.findOneBy({ id, salonId, isActive: true });
    if (!service) throw new NotFoundException();
    Object.assign(service, dto);
    return this.services.save(service);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = await this.mySalonId(req);
    const result = await this.services.update({ id, salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }
}
