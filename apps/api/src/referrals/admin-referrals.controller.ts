import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminReferralQueryDto, CancelReferralDto, UpdateReferralRewardTypeDto } from './dto/referral.dto';
import { ReferralType } from './referral-reward-type.entity';
import { ReferralsService } from './referrals.service';

@Controller('admin/referral-reward-types')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReferralRewardTypesController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  list() {
    return this.referrals.listRewardTypes();
  }

  @Patch(':type')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('referral-reward-type.update', 'referral-reward-type', 'type')
  update(@Param('type') type: ReferralType, @Body() dto: UpdateReferralRewardTypeDto) {
    return this.referrals.updateRewardType(type, dto);
  }
}

@Controller('admin/referrals')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  list(@Query() query: AdminReferralQueryDto) {
    return this.referrals.listForAdmin(
      { status: query.status, referralType: query.referralType, referrerPhone: query.referrerPhone },
      query.page,
      query.pageSize,
    );
  }

  // Piece 3: per-referral referral_rewards detail (both beneficiary sides, if
  // present) -- the admin fraud-review/support surface flagged as missing by both
  // the Slice 3 and Slice 4 admin-panel agents.
  @Get(':id/rewards')
  rewards(@Param('id', ParseUUIDPipe) id: string) {
    return this.referrals.getRewardsForAdmin(id);
  }

  // POST, not PATCH -- matches this codebase's action-endpoint convention
  // (POST /{resource}/:id/{action}, see BookingsController.cancel) rather than the
  // partial-update semantics PATCH implies elsewhere in this file (updateRewardType).
  @Post(':id/cancel')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('referral.cancel', 'referral')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelReferralDto) {
    return this.referrals.cancel(id, dto.reason);
  }
}
