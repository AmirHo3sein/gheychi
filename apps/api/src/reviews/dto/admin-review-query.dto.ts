import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AdminReviewQueryDto {
  @IsOptional()
  @IsUUID()
  salonId?: string;

  // Fuzzy salon-name search (ILIKE), an alternative to the exact-UUID salonId filter
  // above -- see ReviewsService.listForAdmin() for precedence when both are somehow
  // present. Lets an operator filter the queue without already knowing a salon's id.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  salonName?: string;

  @IsOptional()
  @IsIn(['published', 'rejected'])
  status?: 'published' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

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
