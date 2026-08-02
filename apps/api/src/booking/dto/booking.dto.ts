import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
