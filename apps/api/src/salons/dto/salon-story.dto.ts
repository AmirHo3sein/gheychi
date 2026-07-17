import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateStoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  caption?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;
}
