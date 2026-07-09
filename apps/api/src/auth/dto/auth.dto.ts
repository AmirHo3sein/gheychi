import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export const IRAN_MOBILE = /^09\d{9}$/;

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
