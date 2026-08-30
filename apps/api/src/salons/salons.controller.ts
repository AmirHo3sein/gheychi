import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { User } from '../users/user.entity';
import { UpdateHandleDto } from './dto/salon-handle.dto';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonsService } from './salons.service';

@Controller('salons')
export class SalonsController {
  constructor(
    private readonly salons: SalonsService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

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

  // Deliberately its own route/DTO, not folded into UpdateSalonDto -- updateMine() applies
  // its DTO with a blanket Object.assign, so slug's mere presence there would let a stray
  // client-supplied field silently rename a salon's public URL (same privilege-escalation
  // reasoning as the booking-approval timeout columns' own exclusion from UpdateSalonDto).
  @Patch('mine/handle')
  @UseGuards(SalonOwnerGuard)
  updateHandle(@Req() req: Request, @Body() dto: UpdateHandleDto) {
    return this.salons.updateHandle(req.salonId!, dto.handle);
  }

  @Post('mine/resubmit')
  @HttpCode(200)
  @UseGuards(SalonOwnerGuard)
  resubmit(@Req() req: Request) {
    return this.salons.resubmitMine(req.salonId!);
  }

  @Get(':slug')
  @Public()
  async publicProfile(@Param('slug') slug: string) {
    const salon = await this.salons.findPublicBySlug(slug);
    const { reviewsEnabled } = await this.platformConfig.getFeatureFlags();
    // Showing a rating derived from currently-hidden comments would look broken --
    // zeroed here (not just hidden client-side) so a direct API call can't see it either.
    if (!reviewsEnabled) return { ...salon, ratingAvg: '0', ratingCount: 0 };
    return salon;
  }
}
