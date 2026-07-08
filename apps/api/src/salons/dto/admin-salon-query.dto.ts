import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminSalonQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'approved', 'rejected', 'suspended'])
  status?: 'all' | 'pending' | 'approved' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['women', 'men'])
  genderTarget?: 'women' | 'men';

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
