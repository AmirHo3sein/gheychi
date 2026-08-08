import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

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

  // Both omitted = closed all day (unchanged default). Both present = closed only during
  // [startTime, endTime) on `date`. The "both or neither" + startTime < endTime rule is
  // cross-field, so it's checked in ScheduleController.addException (same inline style as
  // replaceHours's own openTime/closeTime check) rather than here.
  @IsOptional()
  @Matches(HHMM)
  startTime?: string;

  @IsOptional()
  @Matches(HHMM)
  endTime?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;

  // Omitted = whole-salon closure (unchanged default). Present = only this one worker is
  // off on `date` -- ScheduleController.addException validates it belongs to the caller's
  // own salon before saving.
  @IsOptional()
  @IsUUID()
  workerId?: string;
}
