import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, MinLength,
  Validate, ValidateIf, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';
import { QualifyingEvent, ReferralType, RewardKind } from '../referral-reward-type.entity';
import { ReferralStatus } from '../referral.entity';

const REFERRAL_TYPES: ReferralType[] = ['user', 'salon_owner', 'worker'];
const REWARD_KINDS: RewardKind[] = ['wallet_credit', 'percent_discount', 'fixed_discount', 'cashback', 'loyalty_points'];
const QUALIFYING_EVENTS: QualifyingEvent[] = ['first_completed_booking', 'first_paid_booking'];
const REFERRAL_STATUSES: ReferralStatus[] = [
  'awaiting_qualifying_event', 'partially_granted', 'reward_granted', 'expired', 'cancelled',
];

// Mirrors admin-config.dto.ts's ConfigValueInBoundsConstraint pattern: a cross-field check
// that the reward *value* stays <= 100 whenever its paired reward *kind* is percent_discount.
// Scope limitation (documented, not an oversight): this DTO is a PATCH-partial, so
// referrerRewardKind/referredRewardKind may be absent from a given request. When the paired
// kind field isn't present on this DTO instance, we can't safely assume percent_discount
// without a service-layer lookup of the persisted kind -- so the cap is only enforced when
// the kind field is actually present (and equal to percent_discount) on this same request.
@ValidatorConstraint({ name: 'percentRewardValueCap', async: false })
class PercentRewardValueCapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    // Non-numeric values are @IsNumber()'s job to reject -- don't double-report here.
    if (typeof value !== 'number' || Number.isNaN(value)) return true;
    const dto = args.object as UpdateReferralRewardTypeDto;
    const kind = args.property === 'referrerRewardValue' ? dto.referrerRewardKind : dto.referredRewardKind;
    if (kind === undefined) return true;
    return !(kind === 'percent_discount' && value > 100);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be at most 100 when the paired reward kind is percent_discount`;
  }
}

export class ValidateCodeQueryDto {
  @IsString()
  @Length(1, 20)
  code: string;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class AdminReferralQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(REFERRAL_STATUSES)
  status?: ReferralStatus;

  @IsOptional()
  @IsIn(REFERRAL_TYPES)
  referralType?: ReferralType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referrerPhone?: string;
}

export class CancelReferralDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;
}

export class UpdateReferralRewardTypeDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(REWARD_KINDS)
  referrerRewardKind?: RewardKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Validate(PercentRewardValueCapConstraint)
  referrerRewardValue?: number;

  // Sending `null` explicitly clears the cap (unlimited); undefined leaves it
  // unchanged -- same @ValidateIf(v !== null) idiom as UpdateCouponDto.maxRedemptions.
  @IsOptional()
  @ValidateIf((_o: UpdateReferralRewardTypeDto, v: unknown) => v !== null)
  @IsNumber()
  @Min(0)
  referrerRewardMax?: number | null;

  @IsOptional()
  @IsIn(REWARD_KINDS)
  referredRewardKind?: RewardKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Validate(PercentRewardValueCapConstraint)
  referredRewardValue?: number;

  @IsOptional()
  @ValidateIf((_o: UpdateReferralRewardTypeDto, v: unknown) => v !== null)
  @IsNumber()
  @Min(0)
  referredRewardMax?: number | null;

  @IsOptional()
  @IsIn(QUALIFYING_EVENTS)
  qualifyingEvent?: QualifyingEvent;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  grantHoldbackHours?: number;

  @IsOptional()
  @ValidateIf((_o: UpdateReferralRewardTypeDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expirationDays?: number | null;

  @IsOptional()
  @ValidateIf((_o: UpdateReferralRewardTypeDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxReferralsPerReferrer?: number | null;
}
