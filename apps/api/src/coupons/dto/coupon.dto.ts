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

  // Unlike expiresAt/maxRedemptions below (which legitimately support null-to-clear
  // semantics), discountPercent has no "clear" semantics -- a platform-wide coupon always
  // needs exactly one discount field populated (coupons_discount_shape_chk). @IsOptional
  // would skip validation for BOTH undefined and null, letting an explicit null slip past
  // @IsInt()/@Min()/@Max() and reach the service, which writes it straight to the row and
  // trips that DB CHECK constraint as an unhandled 500. @ValidateIf here only skips
  // validation when the field is omitted (undefined) -- an explicit null still runs (and
  // correctly fails) validation, producing a normal 400 instead.
  @ValidateIf((_o: UpdateCouponDto, v: unknown) => v !== undefined)
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
