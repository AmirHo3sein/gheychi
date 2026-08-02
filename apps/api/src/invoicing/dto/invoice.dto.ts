import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { InvoicePaymentMethod } from '../invoice-payment.entity';
import { InvoiceStatus } from '../invoice.entity';

const RECORDABLE_METHODS: InvoicePaymentMethod[] = ['bank_transfer', 'cash', 'other'];
const INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid', 'paid', 'void'];

/** PATCH /admin/invoices/:id/payment -- an admin recording a settlement they already made. */
export class RecordInvoicePaymentDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  amount: number;

  // automatic_payout/wallet_credit are reserved for a future automated writer -- an
  // admin manually recording a payment can only ever mean one of these three.
  @IsIn(RECORDABLE_METHODS)
  method: InvoicePaymentMethod;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 100)
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}

/** GET /admin/invoices -- mirrors AdminSalonQueryDto/AdminWalletQueryDto's filter/paginate shape. */
export class AdminInvoiceQueryDto {
  @IsOptional()
  @IsUUID()
  salonId?: string;

  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
