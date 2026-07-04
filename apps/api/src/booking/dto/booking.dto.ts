import { IsUUID } from 'class-validator';

export class AvailabilityQueryDto {
  @IsUUID()
  serviceId: string;
}
