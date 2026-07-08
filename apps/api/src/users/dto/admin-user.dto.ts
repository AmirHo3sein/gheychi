import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class AdminUserQueryDto {
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
