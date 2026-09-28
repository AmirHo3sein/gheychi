import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAX_PRICE_TOMAN } from '../../common/money-limits';
import { PRICING_TYPES, PricingType } from '../service-pricing.util';

export class CreateServiceDto {
  // Exactly one of categoryId/customCategoryId must be set -- enforced in the service layer
  // (validateCategoryChoice) and, as a backstop, by the DB shape CHECK. Both optional here
  // so the service layer can give a clear, specific error rather than two separate
  // "required" complaints when neither (or both) are sent.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsUUID()
  customCategoryId?: string;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Defaults to 'fixed' (today's only shape) when omitted, via class-transformer's plain
  // class-field-default behavior -- an existing API caller that never heard of pricing
  // types keeps working unchanged.
  @IsOptional()
  @IsIn(PRICING_TYPES)
  pricingType: PricingType = 'fixed';

  // Required for fixed/from/range, forbidden for quote -- validatePricingShape (called in
  // the service layer, which sees the full reconciled object) is the actual authority;
  // @ValidateIf here just skips the numeric checks entirely for 'quote' so an absent price
  // doesn't get flagged as "not a number" ahead of the clearer shape-specific message.
  @ValidateIf((o: CreateServiceDto) => o.pricingType !== 'quote')
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_TOMAN)
  price?: number;

  // Only meaningful for 'range' (the ceiling); validatePricingShape rejects it for any
  // other type.
  @IsOptional()
  @ValidateIf((o: CreateServiceDto) => o.pricingType === 'range')
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_TOMAN)
  priceMax?: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  durationMin: number;

  // Display-only upper end of an estimated duration ("2-4 hours") -- never read by the
  // booking/availability engine, which uses durationMin exclusively.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  durationMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;
}

export class UpdateServiceDto {
  @IsOptional() @Type(() => Number) @IsInt() categoryId?: number;
  @IsOptional() @IsUUID() customCategoryId?: string;
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;

  @IsOptional() @IsIn(PRICING_TYPES) pricingType?: PricingType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) priceMax?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMax?: number;

  // Sending `null` explicitly clears the discount; @ValidateIf skips the range check
  // for null (a provider needs a way to remove a discount, not just set one), while
  // @IsOptional already skips the whole chain for undefined (leave unchanged).
  @IsOptional()
  @ValidateIf((_o: UpdateServiceDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number | null;
}
