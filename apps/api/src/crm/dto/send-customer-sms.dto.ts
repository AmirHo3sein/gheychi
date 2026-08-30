import { IsString, Length } from 'class-validator';

export class SendCustomerSmsDto {
  @IsString()
  @Length(1, 500)
  message: string;
}
