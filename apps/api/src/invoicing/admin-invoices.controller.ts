import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminInvoiceQueryDto, RecordInvoicePaymentDto } from './dto/invoice.dto';
import { InvoicingService } from './invoicing.service';

@Controller('admin/invoices')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

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
  recordPayment(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordInvoicePaymentDto) {
    return this.invoicing.recordPayment(id, (req.user as User).id, dto);
  }
}
