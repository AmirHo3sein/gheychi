import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateShowcaseStatusDto {
  @IsIn(['published', 'removed'])
  status: 'published' | 'removed';

  // Optional moderation note. It has no column on the content row — it lands in the
  // audit_log payload (the AuditInterceptor records the raw request body), which is
  // where reversible remove/restore decisions are reconstructed from.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
