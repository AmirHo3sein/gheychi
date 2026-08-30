import { IsString, Length } from 'class-validator';

export class CreateCustomerNoteDto {
  @IsString()
  @Length(1, 1000)
  note: string;
}
