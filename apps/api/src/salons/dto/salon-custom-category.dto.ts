import { IsString, Length } from 'class-validator';

export class CreateCustomCategoryDto {
  @IsString()
  @Length(2, 60)
  name: string;
}
