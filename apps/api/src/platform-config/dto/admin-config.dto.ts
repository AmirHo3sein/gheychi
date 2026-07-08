import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';

class ConfigUpdateEntryDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsNumber()
  value: number;
}

export class UpdateConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigUpdateEntryDto)
  updates: ConfigUpdateEntryDto[];
}
