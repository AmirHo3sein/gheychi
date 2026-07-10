import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, ResolveReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('admin/reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query() query: AdminReportQueryDto) {
    return this.reports.listForAdmin(query);
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('report.resolve', 'report')
  resolve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto) {
    return this.reports.resolve((req.user as User).id, id, dto);
  }
}
