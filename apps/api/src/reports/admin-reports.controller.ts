import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminReportQueryDto, ResolveReportDto } from './dto/report.dto';
import { Report } from './report.entity';
import { ReportsService } from './reports.service';

@Controller('admin/reports')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminReportsController {
  constructor(
    private readonly reports: ReportsService,
    @InjectRepository(Report) private readonly reportsRepo: Repository<Report>,
  ) {}

  @Get()
  list(@Query() query: AdminReportQueryDto) {
    return this.reports.listForAdmin(query);
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('report.resolve', 'report')
  async resolve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto) {
    // Real before/after diff for AuditInterceptor (see its doc comment). Left
    // unset (falls back to the raw request body) when the report doesn't exist --
    // ReportsService.resolve below still owns the 404, this fetch just can't
    // contribute a "before" snapshot in that case.
    const before = await this.reportsRepo.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status, resolutionNote: before.resolutionNote };

    const updated = await this.reports.resolve((req.user as User).id, id, dto);
    req.auditAfter = { status: updated.status, resolutionNote: updated.resolutionNote, resolvedBy: updated.resolvedBy, resolvedAt: updated.resolvedAt };
    return updated;
  }
}
