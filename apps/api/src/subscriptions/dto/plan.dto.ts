import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Length, Matches, Min, Validate } from 'class-validator';
import { KnownEntitlementKeysConstraint } from '../entitlement-keys';

export class CreatePlanDto {
  // Internal identifier -- immutable after creation (absent from UpdatePlanDto below), see
  // Plan entity's own doc comment.
  @IsString()
  @Matches(/^[a-z0-9_-]{2,40}$/)
  key: string;

  @IsString()
  @Length(1, 80)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyPriceToman?: number;

  @IsOptional()
  @IsObject()
  @Validate(KnownEntitlementKeysConstraint)
  entitlements?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyPriceToman?: number;

  @IsOptional()
  @IsObject()
  @Validate(KnownEntitlementKeysConstraint)
  entitlements?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // true moves the default flag to this plan (unsetting every other plan's, atomically --
  // see PlansService.update). false is only accepted when this plan isn't currently the
  // default; the service rejects an attempt to leave the platform with none.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
