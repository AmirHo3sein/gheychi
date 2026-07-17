import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreatePortfolioItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  caption?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

export class UpdatePortfolioItemDto {
  // Explicit null clears the caption (same skip-on-null semantics as serviceId below).
  @IsOptional()
  @IsString()
  @Length(1, 300)
  caption?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // Explicit null clears the service link (@IsOptional skips validation for null,
  // and whitelist keeps the property, so `serviceId: null` reaches the controller).
  @IsOptional()
  @IsUUID()
  serviceId?: string | null;
}
