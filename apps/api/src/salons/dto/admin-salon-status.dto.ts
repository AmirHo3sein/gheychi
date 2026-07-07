import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { IsIn } from 'class-validator';

/**
 * `reason` is required (non-empty, <=500 chars) when status is 'rejected' or 'suspended',
 * and optional-but-still-length-checked when status is 'approved'.
 *
 * Deliberately self-contained rather than stacked with @IsOptional/@IsString/@MinLength/
 * @MaxLength: class-validator's @IsOptional() skips ALL other validators on the same
 * property (including custom ones) whenever the value is undefined, which would silently
 * defeat the "required when rejecting/suspending" rule this decorator exists to enforce.
 */
function RequiredWhenRejectingOrSuspending(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'requiredWhenRejectingOrSuspending',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const status = (args.object as AdminSalonStatusDto).status;
          const requiresReason = status === 'rejected' || status === 'suspended';
          if (value === undefined) return !requiresReason;
          return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
        },
        defaultMessage(args: ValidationArguments) {
          const status = (args.object as AdminSalonStatusDto).status;
          if (status === 'rejected' || status === 'suspended') {
            return 'reason is required when rejecting or suspending a salon';
          }
          return 'reason must be a non-empty string of at most 500 characters';
        },
      },
    });
  };
}

export class AdminSalonStatusDto {
  @IsIn(['approved', 'rejected', 'suspended'])
  status: 'approved' | 'rejected' | 'suspended';

  @RequiredWhenRejectingOrSuspending()
  reason?: string;
}
