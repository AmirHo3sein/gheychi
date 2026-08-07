import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { IRAN_MOBILE } from '../../common/validators';

export class CreateWorkerDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;
}

export class UpdateWorkerDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AssignWorkerDto {
  @IsUUID()
  workerId: string;
}

// An empty array is a valid, meaningful value here (not rejected like categoryIds'
// @ArrayMinSize(1)) -- it's how an owner clears a worker back to "unrestricted, eligible
// for every service", not an error.
export class UpdateWorkerServicesDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  serviceIds: string[];
}

// Optional: with no serviceId, every active worker is listed (unchanged from before this
// feature existed) -- only a caller that actually knows which service it's booking (the
// customer booking page) narrows the list to workers eligible for it.
export class ListWorkersQueryDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

export class WorkerRatingsQueryDto {
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
