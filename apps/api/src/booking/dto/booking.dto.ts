import { IsISO8601, IsUUID } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;
}

export class CreateBookingDto {
  @IsUUID()
  salonId: string;

  @IsUUID()
  serviceId: string;

  @IsISO8601()
  startsAt: string;
}
