import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Keys whose value is a percentage get a 0-100 ceiling; every other key just gets the
// shared >= 0 floor. Mirrors admin-panel's ConfigView.vue client-side bounds so the same
// money-moving sanity check (deposit_percent/commission_percent feed directly into payment
// math) holds even for a request that bypasses the UI.
const PERCENT_CONFIG_KEYS = new Set(['deposit_percent', 'commission_percent']);

@ValidatorConstraint({ name: 'configValueInBounds', async: false })
class ConfigValueInBoundsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    // Non-numeric values are @IsNumber()'s job to reject -- don't double-report here.
    if (typeof value !== 'number' || Number.isNaN(value)) return true;
    if (value < 0) return false;
    const key = (args.object as ConfigUpdateEntryDto).key;
    return !(PERCENT_CONFIG_KEYS.has(key) && value > 100);
  }

  defaultMessage(args: ValidationArguments): string {
    const key = (args.object as ConfigUpdateEntryDto).key;
    return PERCENT_CONFIG_KEYS.has(key)
      ? `value for "${key}" must be between 0 and 100`
      : `value for "${key}" must be at least 0`;
  }
}

class ConfigUpdateEntryDto {
  @IsString()
  @IsNotEmpty()
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
