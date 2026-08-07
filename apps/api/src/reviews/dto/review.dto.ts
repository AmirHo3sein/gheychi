import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  bookingId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // Required iff the booking has a worker assigned (booking.workerId set) -- enforced
  // in ReviewsService.create(), not here, since that depends on the booking row.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  workerRating?: number;
}

export class UpdateReviewDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // Only valid when the review already has a linked WorkerRating -- rejected with a
  // 400 in ReviewsService.update() otherwise (there's no worker to rate).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  workerRating?: number;
}

export class SalonReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reply: string;
}

export class ModerateReviewDto {
  @IsIn(['published', 'rejected'])
  status: 'published' | 'rejected';
}

export class ModerateWorkerRatingDto {
  @IsIn(['published', 'rejected'])
  status: 'published' | 'rejected';
}

export class SalonReviewsQueryDto {
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
