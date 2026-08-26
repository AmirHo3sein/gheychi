import { Body, Controller, Get, Patch, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateFeatureFlagsDto } from './dto/admin-feature-flags.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/feature-flags')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminFeatureFlagsController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get()
  getFeatureFlags() {
    return this.config.getFeatureFlags();
  }

  @Patch()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('feature-flags.update', 'feature-flags')
  async update(@Body() dto: UpdateFeatureFlagsDto, @Req() req: Request) {
    req.auditBefore = await this.config.getFeatureFlags();
    await this.config.setFeatureFlags(dto);
    const after = await this.config.getFeatureFlags();
    req.auditAfter = after;
    return after;
  }
}
