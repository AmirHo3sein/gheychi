import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Mirrors what docker/backup/backup.sh actually knows about its own run -- see that
// script's `curl` call for the exact JSON body shape this must accept.
export class BackupReportDto {
  @IsIn(['success', 'failure'])
  status: 'success' | 'failure';

  // The local dump file's size in bytes (post integrity-check, pre-upload) -- omitted
  // on a failure that happened before pg_dump produced anything at all.
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;

  // Free-text failure reason from the shell script (e.g. "dump file too small: 412
  // bytes", "mc cp exit code 1"). Bounded length -- this lands in a Persian SMS/alert
  // body and an admin-notification row, not a log sink built for arbitrary payloads.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string;
}
