import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { IRAN_MOBILE } from '../../common/validators';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;

  // Optional -- omitted means "any available staff member", matching every existing
  // caller's behavior unchanged. When present, a returned slot is guaranteed free for
  // THIS worker specifically (see availability.util.ts's requestedWorkerId), not merely
  // within the salon's overall capacity.
  @IsOptional()
  @IsUUID()
  workerId?: string;
}

export class CreateBookingDto {
  @IsUUID()
  salonId: string;

  @IsUUID()
  serviceId: string;

  @IsISO8601()
  startsAt: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  couponCode?: string;

  // Deliberately a boolean, not a customer-entered amount: the server always applies
  // min(wallet balance, deposit) -- same "server decides the actual number" idiom as
  // couponCode resolving to a discount amount, so there's nothing for a client to get
  // wrong or a customer to overshoot.
  @IsOptional()
  @IsBoolean()
  applyWalletBalance?: boolean;

  // Optional customer-chosen staff member -- omitted means "any available", exactly
  // today's behavior (worker is assigned later, provider-side, via assignWorker).
  @IsOptional()
  @IsUUID()
  workerId?: string;
}

export class UpdateBookingStatusDto {
  @IsIn(['completed', 'no_show'])
  status: 'completed' | 'no_show';
}

// Required, not optional -- mirrors the salon reject/suspend precedent and the
// category-request reject flow: a customer whose request was turned down deserves a real
// reason, not a bare "no". It is shown to them verbatim in the rejection SMS.
export class RejectBookingDto {
  // Trimmed BEFORE validation, so a whitespace-only reason fails @Length(1, ...) rather
  // than reaching the customer's SMS as a blank "دلیل: ". Same trim-then-validate fix the
  // admin wallet-adjustment reason already carries.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 300)
  reason: string;
}

// The owner recording a customer who called or walked in -- not in the system at all, so
// `phone` is how BookingsService.createManual resolves (or creates) a real `users` row for
// them via the same findOrCreateByPhone SalonWorkersController.create() already uses for
// worker-by-phone onboarding.
export class CreateManualBookingDto {
  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;

  // Only ever applied when the resolved customer has no name yet (a brand-new shadow
  // account, or an existing one that never set one) -- never overwrites a real registered
  // customer's own name. See createManual's own comment.
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsUUID()
  serviceId: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsISO8601()
  startsAt: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  notes?: string;
}
