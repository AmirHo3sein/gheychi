import { IsString, IsUrl, MaxLength } from 'class-validator';

export class SubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;

  @IsString()
  @MaxLength(255)
  p256dh: string;

  @IsString()
  @MaxLength(255)
  auth: string;
}

export class UnsubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint: string;
}
