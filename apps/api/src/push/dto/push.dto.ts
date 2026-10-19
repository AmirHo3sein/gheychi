import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { PUSH_AUDIENCES, PushAudience } from '../push.provider';

export class SubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;

  @IsString()
  @MaxLength(255)
  p256dh: string;

  @IsString()
  @MaxLength(255)
  auth: string;

  /** The app subscribing; absent means the customer app (every client before this field). */
  @IsOptional()
  @IsIn(PUSH_AUDIENCES)
  audience?: PushAudience;
}

export class UnsubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;
}
