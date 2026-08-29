import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateFeatureFlagsDto {
  @IsOptional()
  @IsBoolean()
  reviewsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  storiesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  portfolioEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  referralsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  couponsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  onlinePaymentEnabled?: boolean;
}
