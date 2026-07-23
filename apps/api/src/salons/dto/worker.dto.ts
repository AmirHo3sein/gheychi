import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { IRAN_MOBILE } from '../../auth/dto/auth.dto';

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
