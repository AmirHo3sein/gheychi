import { Type } from 'class-transformer';
import {
  IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf,
} from 'class-validator';

export class CreateCouponDto {
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

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  // Sending `null` explicitly clears the field; @ValidateIf skips the ISO8601 check for
  // null (but not for undefined -- @IsOptional already skips the whole chain for that),
  // so "clear" and "leave unchanged" stay distinguishable all the way to the service.
  @IsOptional()
  @ValidateIf((_o: UpdateCouponDto, v: unknown) => v !== null)
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @ValidateIf((_o: UpdateCouponDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ValidateCouponDto {
  @IsString()
  code: string;

  @IsUUID()
  salonId: string;

  @IsUUID()
  serviceId: string;
}
