import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SORT_ORDERS, SortOrder } from '../../common/admin-sort';

export const ADMIN_SALON_SORTS = ['createdAt', 'name', 'city'] as const;
export type AdminSalonSort = (typeof ADMIN_SALON_SORTS)[number];

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

  /** Default: oldest first (the approval queue's longest-waiting request on top). */
  @IsOptional()
  @IsIn(ADMIN_SALON_SORTS)
  sort?: AdminSalonSort;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;
}
