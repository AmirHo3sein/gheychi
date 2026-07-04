import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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
}

export class UpdateServiceDto {
  @IsOptional() @Type(() => Number) @IsInt() categoryId?: number;
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMin?: number;
}
