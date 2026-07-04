import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HourRangeDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @Matches(HHMM)
  openTime: string;

  @Matches(HHMM)
  closeTime: string;
}

export class ReplaceHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HourRangeDto)
  hours: HourRangeDto[];
}

export class CreateExceptionDto {
  @Matches(ISO_DATE)
  date: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
