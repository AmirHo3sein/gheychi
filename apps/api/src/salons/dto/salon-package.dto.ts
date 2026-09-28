import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { MAX_PRICE_TOMAN } from '../../common/money-limits';
import { PRICING_TYPES, PricingType } from '../service-pricing.util';

export class CreatePackageDto {
  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // Purely informational reference price ("usually around 2,500,000 toman") -- a package
  // is never itself charged. Defaults to 'quote' (no promised number at all), the honest
  // default for a bundle whose real total depends on which items a customer actually books.
  @IsOptional()
  @IsIn(PRICING_TYPES)
  pricingType: PricingType = 'quote';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) priceMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMax?: number;

  // Full membership list, in display order -- a package with only one item isn't really a
  // bundle, so at least two are required. Update replaces this list wholesale rather than
  // diffing individual add/remove operations, matching how the provider-panel form will
  // always submit the complete current selection.
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds: string[];
}

export class UpdatePackageDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(PRICING_TYPES) pricingType?: PricingType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_PRICE_TOMAN) priceMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(1440) durationMax?: number;

  @IsOptional()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}
