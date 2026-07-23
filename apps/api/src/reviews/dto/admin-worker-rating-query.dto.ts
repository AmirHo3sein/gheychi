import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AdminWorkerRatingQueryDto {
  @IsOptional()
  @IsUUID()
  salonId?: string;

  @IsOptional()
  @IsIn(['published', 'rejected'])
  status?: 'published' | 'rejected';

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
