import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { IRAN_MOBILE } from '../../common/validators';

export class RequestOtpDto {
  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  // Only ever read on the isNew branch of registration (R2) -- structurally
  // unavailable to an already-existing account, so there's no separate "already
  // registered" check to get wrong. Never fails registration on its own; see
  // AuthController.verifyOtp.
  @IsOptional()
  @IsString()
  @Length(1, 20)
  referralCode?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsIn(['female', 'male'])
  gender?: 'female' | 'male';
}
