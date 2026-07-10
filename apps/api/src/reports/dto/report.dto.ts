import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateReportDto {
  // Exactly one of salonId/reviewId identifies the target. Each is required (and must
  // be a UUID) whenever the other is absent — so "neither" fails validation on both
  // properties here. The "both provided" case skips both @ValidateIf branches and is
  // rejected in ReportsService.create() with a 400 instead.
  @ValidateIf((o: CreateReportDto) => o.reviewId === undefined)
  @IsUUID()
  salonId?: string;

  @ValidateIf((o: CreateReportDto) => o.salonId === undefined)
  @IsUUID()
  reviewId?: string;

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
