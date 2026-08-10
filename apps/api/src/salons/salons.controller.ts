import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { User } from '../users/user.entity';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonsService } from './salons.service';

@Controller('salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateSalonDto) {
    return this.salons.createForOwner((req.user as User).id, dto);
  }

  @Get('mine')
  mine(@Req() req: Request) {
    return this.salons.findMine((req.user as User).id);
  }

  @Patch('mine')
  @UseGuards(SalonOwnerGuard)
  update(@Req() req: Request, @Body() dto: UpdateSalonDto) {
    return this.salons.updateMine(req.salonId!, dto);
  }

  @Post('mine/resubmit')
  @HttpCode(200)
  @UseGuards(SalonOwnerGuard)
  resubmit(@Req() req: Request) {
    return this.salons.resubmitMine(req.salonId!);
  }

  @Get(':slug')
  @Public()
  publicProfile(@Param('slug') slug: string) {
    return this.salons.findPublicBySlug(slug);
  }
}
