import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsAggregationService } from '../analytics/analytics-aggregation.service';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { User } from '../users/user.entity';
import { CrmService } from './crm.service';
import { CustomerSmsService } from './customer-sms.service';
import { CustomerListQueryDto } from './dto/customer-list-query.dto';
import { CreateCustomerNoteDto } from './dto/customer-note.dto';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';
import { SendCustomerSmsDto } from './dto/send-customer-sms.dto';

/**
 * Defaults to the last 30 days, matching AnalyticsAggregationService's own default window
 * for the admin-side funnel summary -- one convention for "recent activity" across every
 * dashboard in this codebase. Shared by the summary and funnel endpoints below so the two
 * cards on the same screen can never silently cover different periods.
 */
const DEFAULT_RANGE_MS = 30 * 86_400_000;

function resolveRange(query: DashboardSummaryQueryDto): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_MS);
  return { from, to };
}

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
    private readonly analytics: AnalyticsAggregationService,
  ) {}

  // Paginated: `{ items, total, page, pageSize }`, the same envelope AdminSalonsController
  // and AdminUsersController already return. Search/segment/sort are all applied server-side
  // -- a salon with hundreds of customers can't find one by scrolling.
  @Get('customers')
  listCustomers(@Req() req: Request, @Query() query: CustomerListQueryDto) {
    return this.crm.listCustomers(req.salonId!, query);
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
    const { from, to } = resolveRange(query);
    return this.crm.getDashboardSummary(req.salonId!, from, to);
  }

  /**
   * This salon's own slice of the booking funnel, read from `analytics_events.salon_id`.
   *
   * Only stages that actually EMIT an event are reported -- there is no interpolated or
   * back-computed stage. In particular `payment_succeeded` is absent because that event
   * still carries no `salonId` in its properties, so it can never be attributed to a salon
   * (see AnalyticsAggregationService.SALON_FUNNEL_STAGES for the full note). Reporting it
   * as zero would read as "nobody ever pays here", which is a lie.
   */
  @Get('funnel')
  funnel(@Req() req: Request, @Query() query: DashboardSummaryQueryDto) {
    const { from, to } = resolveRange(query);
    return this.analytics.salonFunnel(req.salonId!, from, to);
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
