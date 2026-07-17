import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateReportDto {
  // Exactly one of salonId/reviewId/storyId/portfolioItemId identifies the target.
  // Each is required (and must be a UUID) whenever all its siblings are absent — so
  // "none" fails validation on every property here. Any "more than one" combination
  // skips every @ValidateIf branch and is rejected in ReportsService.create() with
  // a 400 instead.
  @ValidateIf((o: CreateReportDto) => o.reviewId === undefined && o.storyId === undefined && o.portfolioItemId === undefined)
  @IsUUID()
  salonId?: string;

  @ValidateIf((o: CreateReportDto) => o.salonId === undefined && o.storyId === undefined && o.portfolioItemId === undefined)
  @IsUUID()
  reviewId?: string;

  @ValidateIf((o: CreateReportDto) => o.salonId === undefined && o.reviewId === undefined && o.portfolioItemId === undefined)
  @IsUUID()
  storyId?: string;

  @ValidateIf((o: CreateReportDto) => o.salonId === undefined && o.reviewId === undefined && o.storyId === undefined)
  @IsUUID()
  portfolioItemId?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ReportEligibilityQueryDto {
  @IsUUID()
  salonId: string;
}

export class AdminReportQueryDto {
  @IsOptional()
  @IsIn(['open', 'resolved', 'dismissed', 'all'])
  status?: 'open' | 'resolved' | 'dismissed' | 'all';

  @IsOptional()
  @IsUUID()
  salonId?: string;

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

export class ResolveReportDto {
  @IsIn(['resolved', 'dismissed'])
  status: 'resolved' | 'dismissed';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note?: string;
}
