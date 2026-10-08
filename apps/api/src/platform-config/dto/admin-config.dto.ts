import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNotIn,
  IsNumber,
  IsString,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { FEATURE_FLAG_KEYS } from '../platform-config.service';

// Keys whose value is a percentage get a 0-100 ceiling; every other key just gets the
// shared >= 0 floor. Mirrors admin-panel's ConfigView.vue client-side bounds so the same
// money-moving sanity check (deposit_percent/commission_percent feed directly into payment
// math) holds even for a request that bypasses the UI.
const PERCENT_CONFIG_KEYS = new Set(['deposit_percent', 'commission_percent']);
// Mirrors PlatformConfigService's MINUTE_TIMEOUT_KEYS -- see the rationale there. Kept in
// sync deliberately: this is the write path, that is the boot/read path, and a value this
// accepted but that rejected would brick the API on its next restart.
const MINUTE_TIMEOUT_CONFIG_KEYS = new Set(['booking_approval_timeout_minutes', 'booking_hold_ttl_minutes']);
// Mirrors PlatformConfigService's GRACE_MINUTE_KEYS bounds. 0 is legal (no grace at all).
const GRACE_MINUTE_CONFIG_KEYS = new Set(['no_show_grace_minutes']);
// Mirrors PlatformConfigService's BEAUTY_GUIDE_KEY_BOUNDS exactly -- same brick-on-restart
// hazard as above. Whole numbers only: these are counts/days.
const BEAUTY_GUIDE_CONFIG_BOUNDS: Record<string, { min: number; max: number }> = {
  beauty_guide_daily_limit_per_user: { min: 0, max: 1000 },
  beauty_guide_daily_limit_global: { min: 0, max: 1_000_000 },
  beauty_guide_retention_days: { min: 1, max: 3650 },
};

// Whole hours only, 0 (no free-cancel window) to 30 days. Each booking SNAPSHOTS this value into an
// integer column at creation, so a fractional window (1.5) would make every booking insert fail.
const WHOLE_HOUR_CONFIG_BOUNDS: Record<string, { min: number; max: number }> = {
  cancellation_window_hours: { min: 0, max: 720 },
};

// Mirrors PlatformConfigService's BOOKING_LIMIT_KEY_BOUNDS exactly (same brick-on-restart
// hazard). Whole numbers; a cap of 0 would block every online booking.
const BOOKING_LIMIT_CONFIG_BOUNDS: Record<string, { min: number; max: number }> = {
  booking_max_active_per_user: { min: 1, max: 50 },
  booking_max_active_per_salon_per_user: { min: 1, max: 20 },
};

@ValidatorConstraint({ name: 'configValueInBounds', async: false })
class ConfigValueInBoundsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    // Non-numeric values are @IsNumber()'s job to reject -- don't double-report here.
    if (typeof value !== 'number' || Number.isNaN(value)) return true;
    if (value < 0) return false;
    const key = (args.object as ConfigUpdateEntryDto).key;
    if (MINUTE_TIMEOUT_CONFIG_KEYS.has(key)) return Number.isInteger(value) && value >= 1 && value <= 1440;
    if (GRACE_MINUTE_CONFIG_KEYS.has(key)) return Number.isInteger(value) && value <= 1440;
    const wholeHourBounds = WHOLE_HOUR_CONFIG_BOUNDS[key];
    if (wholeHourBounds) return Number.isInteger(value) && value >= wholeHourBounds.min && value <= wholeHourBounds.max;
    const bookingLimitBounds = BOOKING_LIMIT_CONFIG_BOUNDS[key];
    if (bookingLimitBounds) {
      return Number.isInteger(value) && value >= bookingLimitBounds.min && value <= bookingLimitBounds.max;
    }
    const beautyBounds = BEAUTY_GUIDE_CONFIG_BOUNDS[key];
    if (beautyBounds) return Number.isInteger(value) && value >= beautyBounds.min && value <= beautyBounds.max;
    return !(PERCENT_CONFIG_KEYS.has(key) && value > 100);
  }

  defaultMessage(args: ValidationArguments): string {
    const key = (args.object as ConfigUpdateEntryDto).key;
    if (PERCENT_CONFIG_KEYS.has(key)) return `value for "${key}" must be between 0 and 100`;
    if (MINUTE_TIMEOUT_CONFIG_KEYS.has(key)) return `value for "${key}" must be a whole number of minutes between 1 and 1440`;
    if (GRACE_MINUTE_CONFIG_KEYS.has(key)) return `value for "${key}" must be a whole number of minutes between 0 and 1440`;
    const wholeHourBounds = WHOLE_HOUR_CONFIG_BOUNDS[key];
    if (wholeHourBounds) return `value for "${key}" must be a whole number of hours between ${wholeHourBounds.min} and ${wholeHourBounds.max}`;
    const bookingLimitBounds = BOOKING_LIMIT_CONFIG_BOUNDS[key];
    if (bookingLimitBounds) {
      return `value for "${key}" must be a whole number between ${bookingLimitBounds.min} and ${bookingLimitBounds.max}`;
    }
    const beautyBounds = BEAUTY_GUIDE_CONFIG_BOUNDS[key];
    if (beautyBounds) return `value for "${key}" must be a whole number between ${beautyBounds.min} and ${beautyBounds.max}`;
    return `value for "${key}" must be at least 0`;
  }
}

class ConfigUpdateEntryDto {
  @IsString()
  @IsNotEmpty()
  // Feature flags are booleans with their own endpoint; a number written here is read back
  // by the boot check as a non-boolean flag.
  @IsNotIn([...FEATURE_FLAG_KEYS], { message: 'feature flags are changed through /admin/feature-flags, not /admin/config' })
  key: string;

  @IsNumber()
  @Validate(ConfigValueInBoundsConstraint)
  value: number;
}

export class UpdateConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigUpdateEntryDto)
  updates: ConfigUpdateEntryDto[];
}
