import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/**
 * Admin-only per-salon timeout overrides.
 *
 * `null` is a meaningful, explicitly-supported value on both fields: it clears the
 * override so the salon falls back to the global platform default. That is why each field
 * uses `@ValidateIf(value !== null)` rather than a bare `@IsOptional()` -- `@IsOptional()`
 * skips validation for null AND undefined alike, which reads as "null is untyped", whereas
 * here null is a first-class instruction ("inherit") that must survive whitelisting.
 *
 * Bounds mirror the DB CHECK constraints exactly (1..1440 minutes). Zero and negatives are
 * rejected at both layers: a zero-minute window would expire every request before a human
 * could possibly see it, and an unbounded one would let a salon sit on a customer's slot
 * indefinitely.
 */
export class UpdateSalonBookingSettingsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  approvalTimeoutMinutes?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  paymentTimeoutMinutes?: number | null;
}
