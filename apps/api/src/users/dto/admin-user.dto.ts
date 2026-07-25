import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min,
} from 'class-validator';

export class AdminUserQueryDto {
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

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['customer', 'provider', 'admin'])
  role?: 'customer' | 'provider' | 'admin';

  @IsOptional()
  @IsISO8601()
  joinedFrom?: string;

  @IsOptional()
  @IsISO8601()
  joinedTo?: string;
}

export class AdminUserStatusDto {
  @IsIn(['active', 'suspended'])
  status: 'active' | 'suspended';
}
