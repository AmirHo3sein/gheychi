import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Salon } from '../salons/salon.entity';
import { RecordInvoicePaymentDto, AdminInvoiceQueryDto } from './dto/invoice.dto';
import { FinancialTransaction } from './financial-transaction.entity';
import { InvoiceItem } from './invoice-item.entity';
import { InvoicePayment } from './invoice-payment.entity';
import { Invoice, InvoiceStatus } from './invoice.entity';

@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(FinancialTransaction) private readonly transactions: Repository<FinancialTransaction>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceItem) private readonly invoiceItems: Repository<InvoiceItem>,
    @InjectRepository(InvoicePayment) private readonly invoicePayments: Repository<InvoicePayment>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    private readonly dataSource: DataSource,
    private readonly config: PlatformConfigService,
  ) {}

  /**
   * Inserts one commission_accrued row for a booking that just reached completed/
   * no_show. MUST run inside the same transaction as the caller's booking-status write
   * (em is the caller's EntityManager, not a fresh one) -- see
   * BookingsService.updateStatus, the only real caller.
   *
   * Commission applies to depositAmount (the only money the platform ever captures
   * online), never priceSnapshot -- see FinancialTransaction's own doc comment. A
   * booking whose deposit was fully wallet-covered or fully discounted has nothing to
   * accrue commission against, so this is a deliberate no-op for grossAmount <= 0, not
   * a zero-amount row.
   */
  async recordCommission(
    em: EntityManager,
    booking: { id: string; salonId: string; depositAmount: number },
  ): Promise<void> {
    const grossAmount = booking.depositAmount;
    if (grossAmount <= 0) return;

    const commissionPercent = await this.config.getCommissionPercent();
    const commissionAmount = Math.round((grossAmount * commissionPercent) / 100);
    const netAmount = grossAmount - commissionAmount;

    await em.getRepository(FinancialTransaction).insert({
      bookingId: booking.id,
      salonId: booking.salonId,
      type: 'commission_accrued',
      grossAmount,
      // Entity type is string (matches Worker.ratingAvg/Salon.ratingAvg's numeric-
      // column convention -- pg always returns numeric as a string, so the entity is
      // typed for what reads back, and writes must match).
      commissionRate: commissionPercent.toFixed(2),
      commissionAmount,
      netAmount,
      correctionOfId: null,
    });
  }

  async listForAdmin(
    query: AdminInvoiceQueryDto,
  ): Promise<{ items: Array<Invoice & { salonName: string }>; total: number; page: number; pageSize: number }> {
    const qb = this.invoices
      .createQueryBuilder('invoice')
      .orderBy('invoice.periodStart', 'DESC')
      .addOrderBy('invoice.salonId', 'ASC');
    if (query.salonId) qb.andWhere('invoice.salonId = :salonId', { salonId: query.salonId });
    if (query.status) qb.andWhere('invoice.status = :status', { status: query.status });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    const enriched = await this.attachSalonNames(items);
    return { items: enriched, total, page, pageSize };
  }

  async getForAdmin(id: string): Promise<{ invoice: Invoice & { salonName: string }; items: InvoiceItem[] }> {
    const invoice = await this.invoices.findOneBy({ id });
    if (!invoice) throw new NotFoundException();
    const items = await this.invoiceItems.find({ where: { invoiceId: id }, order: { createdAt: 'ASC' } });
    const [enriched] = await this.attachSalonNames([invoice]);
    return { invoice: enriched, items };
  }

  async listForSalon(salonId: string): Promise<Invoice[]> {
    return this.invoices.find({ where: { salonId }, order: { jalaliYear: 'DESC', jalaliMonth: 'DESC' } });
  }

  /**
   * Never touches financial_transactions/invoice_items -- only this invoice's own
   * cached paidTotal/status. Multiple calls simply keep inserting invoice_payments rows
   * (partial payments); status is re-derived from the running paidTotal each time, so a
   * payment recorded after totalNetPayable increased (a late-arriving item on an
   * already-paid invoice) correctly flips paid back to partially_paid.
   */
  async recordPayment(id: string, adminId: string, dto: RecordInvoicePaymentDto): Promise<Invoice> {
    return this.dataSource.transaction(async (em) => {
      const invoice = await em.findOneBy(Invoice, { id });
      if (!invoice) throw new NotFoundException();

      await em.insert(InvoicePayment, {
        invoiceId: id,
        amount: dto.amount,
        method: dto.method,
        referenceNumber: dto.referenceNumber ?? null,
        note: dto.note ?? null,
        recordedByAdminId: adminId,
      });

      const paidTotal = invoice.paidTotal + dto.amount;
      const status: InvoiceStatus = paidTotal >= invoice.totalNetPayable ? 'paid' : 'partially_paid';
      await em.update(
        Invoice,
        { id },
        { paidTotal, status, paidAt: status === 'paid' ? new Date() : invoice.paidAt },
      );

      return (await em.findOneBy(Invoice, { id }))!;
    });
  }

  async listPaymentsForAdmin(invoiceId: string): Promise<InvoicePayment[]> {
    return this.invoicePayments.find({ where: { invoiceId }, order: { createdAt: 'DESC' } });
  }

  private async attachSalonNames<T extends { salonId: string }>(rows: T[]): Promise<Array<T & { salonName: string }>> {
    if (rows.length === 0) return [];
    const salonIds = [...new Set(rows.map((r) => r.salonId))];
    const salonRows = await this.salons.find({ where: { id: In(salonIds) } });
    const nameById = new Map(salonRows.map((s) => [s.id, s.name]));
    return rows.map((r) => ({ ...r, salonName: nameById.get(r.salonId) ?? 'Unknown salon' }));
  }
}
