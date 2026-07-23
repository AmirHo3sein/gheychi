import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

export class CreateServiceDto {
  @Type(() => Number)
  @IsInt()
  categoryId: number;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  price: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  durationMin: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number;
}

export class UpdateServiceDto {
  @IsOptional() @Type(() => Number) @IsInt() categoryId?: number;
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMin?: number;

  // Sending `null` explicitly clears the discount; @ValidateIf skips the range check
  // for null (a provider needs a way to remove a discount, not just set one), while
  // @IsOptional already skips the whole chain for undefined (leave unchanged).
  @IsOptional()
  @ValidateIf((_o: UpdateServiceDto, v: unknown) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  discountPercent?: number | null;
}
