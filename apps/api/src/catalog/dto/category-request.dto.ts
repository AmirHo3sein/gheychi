import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCategoryRequestDto {
  @IsString()
  @Length(2, 60)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class AdminCategoryRequestQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'all'])
  status?: 'pending' | 'approved' | 'rejected' | 'all';

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

// The admin picks the final name/icon here (pre-filled from the request's own name in
// the admin-panel UI, but not trusted server-side as-is) -- same shape as
// CreateCategoryDto, since this is the same underlying create.
export class ApproveCategoryRequestDto {
  @IsString()
  @Length(1, 60)
  name: string;

  @IsString()
  @Length(1, 20)
  icon: string;
}

export class RejectCategoryRequestDto {
  // Required, not optional -- mirrors the salon reject/suspend precedent (a provider
  // waiting on a request deserves a real reason, not a bare "no").
  @IsString()
  @Length(1, 500)
  note: string;
}
