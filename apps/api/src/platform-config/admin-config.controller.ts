import { Body, Controller, Get, Patch, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateConfigDto } from './dto/admin-config.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/config')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get()
  list() {
    return this.config.listAll();
  }

  @Patch()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('config.update', 'config')
  async update(@Body() dto: UpdateConfigDto, @Req() req: Request) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Full
    // snapshots rather than just the changed keys -- listAll() is already cheap
    // (one small table) and a full snapshot lets an auditor see the config's
    // whole state at the time of the change, not just the delta.
    req.auditBefore = await this.config.listAll();
    await this.config.setMany(dto.updates);
    const after = await this.config.listAll();
    req.auditAfter = after;
    return after;
  }
}
