import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminInvoiceQueryDto, RecordInvoicePaymentDto } from './dto/invoice.dto';
import { Invoice } from './invoice.entity';
import { InvoicingService } from './invoicing.service';

@Controller('admin/invoices')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminInvoicesController {
  constructor(
    private readonly invoicing: InvoicingService,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  @Get()
  list(@Query() query: AdminInvoiceQueryDto) {
    return this.invoicing.listForAdmin(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.getForAdmin(id);
  }

  @Get(':id/payments')
  listPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicing.listPaymentsForAdmin(id);
  }

  // "Record" a payment the admin already made outside the system (a bank transfer),
  // not initiate one -- there is no payout infrastructure to call.
  @Patch(':id/payment')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('invoice.payment.record', 'invoice')
  async recordPayment(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordInvoicePaymentDto) {
    // Real before/after diff for AuditInterceptor (see its doc comment): this is
    // money-adjacent (an admin recording a bank transfer they already made), so the
    // audit row should show the invoice's actual status/paidTotal transition, not
    // just the payment amount that was submitted. Left unset (falls back to the raw
    // request body) when the invoice doesn't exist -- InvoicingService.recordPayment
    // below still owns the 404, this fetch just can't contribute a "before" snapshot
    // in that case.
    const before = await this.invoices.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status, paidTotal: before.paidTotal };

    const updated = await this.invoicing.recordPayment(id, (req.user as User).id, dto);
    req.auditAfter = { status: updated.status, paidTotal: updated.paidTotal, paidAt: updated.paidAt };
    return updated;
  }
}
