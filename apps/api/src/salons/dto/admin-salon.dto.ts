import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

export class SetFeaturedDto {
  @IsBoolean()
  isFeatured: boolean;

  @IsOptional()
  @IsISO8601()
  featuredUntil?: string;
}
