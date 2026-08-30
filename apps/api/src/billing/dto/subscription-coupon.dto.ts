import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class CreateSubscriptionCouponDto {
  @IsString()
  @Length(3, 30)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number;
}

export class UpdateSubscriptionCouponDto {
  // No "clear" semantics -- discountPercent is always required on this table (unlike the
  // booking coupon's percent-or-fixed shape), so @IsOptional would let an explicit null
  // slip past validation and reach the service, same reasoning as UpdateCouponDto's own
  // discountPercent field.
  @ValidateIf((_o: UpdateSubscriptionCouponDto, v: unknown) => v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @ValidateIf((_o: UpdateSubscriptionCouponDto, v: unknown) => v !== null)
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @ValidateIf((_o: UpdateSubscriptionCouponDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
