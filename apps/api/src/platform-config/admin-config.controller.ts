import { Body, Controller, Get, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateConfigDto } from './dto/admin-config.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/config')
@UseGuards(AuthGuard, RolesGuard)
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
  async update(@Body() dto: UpdateConfigDto) {
    await this.config.setMany(dto.updates);
    return this.config.listAll();
  }
}
