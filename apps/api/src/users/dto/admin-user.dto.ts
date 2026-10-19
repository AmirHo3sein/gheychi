import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min,
} from 'class-validator';
import { SORT_ORDERS, SortOrder } from '../../common/admin-sort';

export const ADMIN_USER_SORTS = ['createdAt', 'name', 'phone'] as const;
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

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

  /** Default: newest members first. */
  @IsOptional()
  @IsIn(ADMIN_USER_SORTS)
  sort?: AdminUserSort;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;
}

export class UpdateUserStatusDto {
  @IsIn(['active', 'suspended'])
  status: 'active' | 'suspended';
}
