import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { AdminInvoicesController } from './admin-invoices.controller';
import { FinancialTransaction } from './financial-transaction.entity';
import { InvoiceItem } from './invoice-item.entity';
import { InvoicePayment } from './invoice-payment.entity';
import { Invoice } from './invoice.entity';
import { InvoicingService } from './invoicing.service';
import { MonthlyInvoiceGenerationJob } from './monthly-invoice-generation.job';
import { SalonInvoicesController } from './salon-invoices.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FinancialTransaction, Invoice, InvoiceItem, InvoicePayment]),
    PlatformConfigModule,
    // For the Salon repo (salon-name enrichment) and SalonOwnerGuard -- SalonsModule
    // has no dependency back on this module, plain one-directional import.
    SalonsModule,
    AuthModule,
    AuditModule,
    AlertsModule,
  ],
  controllers: [AdminInvoicesController, SalonInvoicesController],
  providers: [InvoicingService, MonthlyInvoiceGenerationJob],
  // BookingsService calls recordCommission() inside its own updateStatus transaction --
  // BookingModule imports this module for InvoicingService.
  exports: [InvoicingService],
})
export class InvoicingModule {}
