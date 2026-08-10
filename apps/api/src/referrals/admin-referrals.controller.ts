import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminReferralQueryDto, CancelReferralDto, UpdateReferralRewardTypeDto } from './dto/referral.dto';
import { Referral } from './referral.entity';
import { ReferralRewardType, ReferralType } from './referral-reward-type.entity';
import { ReferralsService } from './referrals.service';

@Controller('admin/referral-reward-types')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminReferralRewardTypesController {
  constructor(
    private readonly referrals: ReferralsService,
    @InjectRepository(ReferralRewardType) private readonly rewardTypesRepo: Repository<ReferralRewardType>,
  ) {}

  @Get()
  list() {
    return this.referrals.listRewardTypes();
  }

  // Real before/after diff for AuditInterceptor (see its doc comment) -- this is a
  // platform-wide config row (whether the referral type is enabled at all, its
  // reward kinds/values/caps, qualifying event, hold-back, expiry), same reasoning
  // as admin-config.controller.ts's full-snapshot approach. Left unset (falls back
  // to the raw request body) on the defensive "not found" case; there are only 3
  // fixed, seeded rows (see the entity's own doc comment) so this should never
  // actually happen, but ReferralsService.updateRewardType still owns the 404.
  @Patch(':type')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('referral-reward-type.update', 'referral-reward-type', 'type')
  async update(@Param('type') type: ReferralType, @Body() dto: UpdateReferralRewardTypeDto, @Req() req: Request) {
    const before = await this.rewardTypesRepo.findOneBy({ referralType: type });
    if (before) req.auditBefore = before;

    const updated = await this.referrals.updateRewardType(type, dto);
    req.auditAfter = updated;
    return updated;
  }
}

@Controller('admin/referrals')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    @InjectRepository(Referral) private readonly referralsRepo: Repository<Referral>,
  ) {}

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
  //
  // Real before/after diff for AuditInterceptor (see its doc comment) -- cancel is a
  // real status transition (awaiting_qualifying_event -> cancelled) with a real prior
  // state worth capturing, same reasoning as user/salon status-set. Left unset (falls
  // back to the raw request body) when the referral doesn't exist; ReferralsService.cancel
  // below still owns the 404/409.
  @Post(':id/cancel')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('referral.cancel', 'referral')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelReferralDto, @Req() req: Request) {
    const before = await this.referralsRepo.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status, cancelledReason: before.cancelledReason };

    const updated = await this.referrals.cancel(id, dto.reason);
    req.auditAfter = { status: updated.status, cancelledReason: updated.cancelledReason };
    return updated;
  }
}
