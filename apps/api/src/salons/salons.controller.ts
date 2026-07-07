import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonsService } from './salons.service';

@Controller('salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() req: Request, @Body() dto: CreateSalonDto) {
    return this.salons.createForOwner((req.user as User).id, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@Req() req: Request) {
    return this.salons.findMine((req.user as User).id);
  }

  @Patch('mine')
  @UseGuards(AuthGuard)
  update(@Req() req: Request, @Body() dto: UpdateSalonDto) {
    return this.salons.updateMine((req.user as User).id, dto);
  }

  @Post('mine/resubmit')
  @UseGuards(AuthGuard)
  resubmit(@Req() req: Request) {
    return this.salons.resubmitMine((req.user as User).id);
  }

  @Get(':slug')
  publicProfile(@Param('slug') slug: string) {
    return this.salons.findPublicBySlug(slug);
  }
}
