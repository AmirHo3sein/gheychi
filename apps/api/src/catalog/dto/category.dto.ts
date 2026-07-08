import { IsOptional, IsString, Length } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 60)
  name: string;

  @IsString()
  @Length(1, 20)
  icon: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsString() @Length(1, 20) icon?: string;
}
