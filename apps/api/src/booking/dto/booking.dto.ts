import { IsIn, IsISO8601, IsUUID } from 'class-validator';

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

export class UpdateBookingStatusDto {
  @IsIn(['completed', 'no_show'])
  status: 'completed' | 'no_show';
}
