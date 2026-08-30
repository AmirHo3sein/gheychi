import { IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { BillingPeriodStatus } from '../subscription-billing-period.entity';

export class CreateBillingPeriodDto {
  @IsISO8601()
  periodStart: string;

  @IsISO8601()
  periodEnd: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  couponCode?: string;
}

const RESOLVABLE_STATUSES: BillingPeriodStatus[] = ['paid', 'comped', 'void'];

export class SetBillingPeriodStatusDto {
  @IsIn(RESOLVABLE_STATUSES)
  status: 'paid' | 'comped' | 'void';
}
