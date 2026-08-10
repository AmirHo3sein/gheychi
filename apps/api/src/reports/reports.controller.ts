import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { CreateReportDto, ReportEligibilityQueryDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateReportDto) {
    return this.reports.create((req.user as User).id, dto);
  }

  @Get('eligibility')
  async eligibility(@Req() req: Request, @Query() query: ReportEligibilityQueryDto) {
    return { canReport: await this.reports.canReport((req.user as User).id, query.salonId) };
  }
}
