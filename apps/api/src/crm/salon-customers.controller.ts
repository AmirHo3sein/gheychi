import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { User } from '../users/user.entity';
import { CrmService } from './crm.service';
import { CustomerSmsService } from './customer-sms.service';
import { CreateCustomerNoteDto } from './dto/customer-note.dto';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';
import { SendCustomerSmsDto } from './dto/send-customer-sms.dto';

// Salon-scoped CRM (Phase 5 of the monetization initiative -- see
// docs/technical-overview/32-salon-crm.md) plus salon-initiated customer SMS (Phase 6 -- see
// docs/technical-overview/33-salon-sms-quota.md). Strictly the salon owner's own data: every
// method routes through req.salonId from SalonOwnerGuard, never a caller-supplied salon id.
@Controller('salons/mine')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonCustomersController {
  constructor(
    private readonly crm: CrmService,
    private readonly customerSms: CustomerSmsService,
  ) {}

  @Get('customers')
  listCustomers(@Req() req: Request) {
    return this.crm.listCustomers(req.salonId!);
  }

  @Get('customers/:customerId')
  getCustomer(@Req() req: Request, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.crm.getCustomerDetail(req.salonId!, customerId);
  }

  @Post('customers/:customerId/notes')
  addNote(
    @Req() req: Request,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateCustomerNoteDto,
  ) {
    return this.crm.addNote(req.salonId!, customerId, (req.user as User).id, dto.note);
  }

  @Delete('customers/:customerId/notes/:noteId')
  @HttpCode(204)
  async deleteNote(
    @Req() req: Request,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    await this.crm.deleteNote(req.salonId!, customerId, noteId);
  }

  @Get('dashboard-summary')
  dashboardSummary(@Req() req: Request, @Query() query: DashboardSummaryQueryDto) {
    // Defaults to the last 30 days, matching AnalyticsAggregationService's own default
    // window for the admin-side funnel summary -- one convention for "recent activity"
    // across this codebase's dashboards.
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    return this.crm.getDashboardSummary(req.salonId!, from, to);
  }

  @Get('sms-quota')
  getSmsQuota(@Req() req: Request) {
    return this.customerSms.getQuotaStatus(req.salonId!);
  }

  @Post('customers/:customerId/sms')
  sendSms(
    @Req() req: Request,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: SendCustomerSmsDto,
  ) {
    return this.customerSms.send(req.salonId!, customerId, (req.user as User).id, dto.message);
  }
}
